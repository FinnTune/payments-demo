import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import {
  IVpc,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  ContainerInsights,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
  Secret as EcsSecret,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DatabaseInstance } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

interface ServiceStackProps extends StackProps {
  vpc: IVpc;
  database: DatabaseInstance;
  credentialsSecret: Secret;
  databaseSecurityGroup: SecurityGroup;
  jwtIssuerUri: string;
}

/**
 * Runs the Spring Boot backend on ECS Fargate behind an ALB.
 *
 * Wires together every piece:
 * - Container image from an ECR repo (built and pushed by CI/CD).
 * - Database URL and credentials from the data stack's RDS + secret.
 * - JWT issuer URL from the auth stack's Cognito user pool.
 * - ALB in public subnets, tasks in private-with-egress subnets.
 * - WAF in front of the ALB (managed rule sets for common attacks).
 * - Autoscaling 1-10 tasks based on CPU.
 */
export class ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    // ---------- ECR repository ----------
    // The deploy pipeline pushes images here; ECS pulls from here.
    const repository = new Repository(this, 'PaymentsRepo', {
      repositoryName: 'payments-service',
      imageScanOnPush: true,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // ---------- ECS Cluster ----------
    const cluster = new Cluster(this, 'PaymentsCluster', {
        vpc: props.vpc,
        clusterName: 'payments-cluster',
        containerInsightsV2: ContainerInsights.ENABLED,
      });

    // ---------- Log group ----------
    const logGroup = new LogGroup(this, 'PaymentsLogs', {
      logGroupName: '/payments/service',
      retention: RetentionDays.ONE_MONTH,
    });

    // ---------- Task definition ----------
    const taskDefinition = new FargateTaskDefinition(this, 'PaymentsTaskDef', {
      cpu: 1024,                    // 1 vCPU
      memoryLimitMiB: 2048,         // 2 GB
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    taskDefinition.addContainer('app', {
      image: ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: LogDriver.awsLogs({ streamPrefix: 'payments', logGroup }),
      portMappings: [{ containerPort: 8080 }],

      environment: {
        SPRING_PROFILES_ACTIVE: 'prod',
        JWT_ISSUER_URI: props.jwtIssuerUri,
        DB_URL: `jdbc:postgresql://${props.database.instanceEndpoint.hostname}:5432/payments`,
      },

      // Pull DB credentials from Secrets Manager at task start.
      secrets: {
        DB_USER:     EcsSecret.fromSecretsManager(props.credentialsSecret, 'username'),
        DB_PASSWORD: EcsSecret.fromSecretsManager(props.credentialsSecret, 'password'),
      },

      healthCheck: {
        command: ['CMD-SHELL', 'wget -q -O - http://localhost:8080/actuator/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),  // grace period for slow JVM startup
      },
    });

    const serviceSecurityGroup = new SecurityGroup(this, 'ServiceSecurityGroup', {
        vpc: props.vpc,
        description: 'Allow ALB → ECS task traffic',
        allowAllOutbound: false,
      });
      
      // The task needs HTTPS outbound to reach AWS service APIs (Secrets
      // Manager, ECR, CloudWatch Logs) and the Cognito JWKs endpoint.
      serviceSecurityGroup.addEgressRule(
        Peer.anyIpv4(),
        Port.tcp(443),
        'HTTPS to AWS APIs and Cognito',
      );

      const service = new FargateService(this, 'PaymentsService', {
        cluster,
        taskDefinition,
        desiredCount: 2,
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [serviceSecurityGroup],
        assignPublicIp: false,
        enableExecuteCommand: true,
      
        // Fail bad deploys quickly instead of timing out after 3 hours.
        circuitBreaker: { rollback: true },
      
        // Never drop below desired count during deploys; let overshoot
        // briefly while new tasks come up. With desiredCount=2, this
        // means deploys spin up 2 new tasks before draining the old 2.
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
      });

    // Allow the service to reach the database on its default port (5432).
    // CDK's connections API handles cross-stack security group rules
    // correctly: the egress rule lands in this (service) stack, the
    // ingress rule lands in the data stack.
    service.connections.allowToDefaultPort(props.database, 'Postgres from payments service');

    // ---------- ALB ----------
    const alb = new ApplicationLoadBalancer(this, 'PaymentsAlb', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });

    const listener = alb.addListener('Http', {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        // In real production: redirect to 443 instead. We don't have
        // an ACM cert in this demo.
      });

    listener.addTargets('PaymentsTargets', {
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/actuator/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        unhealthyThresholdCount: 3,
        healthyThresholdCount: 2,
      },
      deregistrationDelay: Duration.seconds(30),  // graceful drain on deploy
    });

    // ---------- Autoscaling ----------
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(300),
      scaleOutCooldown: Duration.seconds(60),
    });

    // ---------- WAF ----------
    const webAcl = new CfnWebACL(this, 'PaymentsWaf', {
      scope: 'REGIONAL',  // ALB is regional (CloudFront is global)
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'PaymentsWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
        // AWS managed rules: common attack patterns (SQLi, XSS, etc.)
        {
          name: 'AWS-CommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // Rate limit: 2000 requests per 5 minutes per IP
        {
          name: 'RateLimit',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'PaymentsWafAssociation', {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // ---------- Grant the task IAM to read the secret ----------
    props.credentialsSecret.grantRead(taskDefinition.taskRole);
  }
}