import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { EcsTask } from 'aws-cdk-lib/aws-events-targets';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface ReconStackProps extends StackProps {
  vpc: IVpc;
  cluster: ICluster;
}

/**
 * Daily reconciliation job: reads settlement CSVs from S3, runs the
 * pure matching logic from recon/, writes findings JSON back to S3.
 *
 * Triggered by EventBridge on a cron schedule. Runs as a Fargate
 * task on the existing ECS cluster from the service stack — no need
 * for a dedicated cluster, since Fargate tasks don't share underlying
 * infrastructure anyway.
 */
export class ReconStack extends Stack {
  constructor(scope: Construct, id: string, props: ReconStackProps) {
    super(scope, id, props);

    // ---------- S3 bucket for settlement files & findings ----------
    const bucket = new Bucket(this, 'ReconBucket', {
      bucketName: `payments-recon-${this.account}-${this.region}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'expire-old-files',
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,  // demo only
    });

    // ---------- ECR repo for the recon image ----------
    const repository = new Repository(this, 'ReconRepo', {
      repositoryName: 'payments-recon',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    // ---------- Log group ----------
    const logGroup = new LogGroup(this, 'ReconLogs', {
      logGroupName: '/payments/recon',
      retention: RetentionDays.ONE_MONTH,
    });

    // ---------- Task definition ----------
    const taskDefinition = new FargateTaskDefinition(this, 'ReconTaskDef', {
      cpu: 512,                  // 0.5 vCPU — recon is I/O-bound
      memoryLimitMiB: 1024,      // 1 GB
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    taskDefinition.addContainer('recon', {
      image: ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: LogDriver.awsLogs({ streamPrefix: 'recon', logGroup }),

      environment: {
        S3_BUCKET: bucket.bucketName,
      },

      // Default command — overridden by the EventBridge target at
      // invocation time with the specific date's files.
      command: ['--help'],
    });

    // The task needs to read settlement files and write findings.
    bucket.grantReadWrite(taskDefinition.taskRole);

    // ---------- EventBridge schedule ----------
    // Daily at 03:00 UTC = 05:00-06:00 Helsinki local (winter/summer).
    const rule = new Rule(this, 'ReconSchedule', {
      schedule: Schedule.cron({
        minute: '0',
        hour: '3',
      }),
      description: 'Daily reconciliation of payments vs gateway settlement',
    });

    rule.addTarget(
      new EcsTask({
        cluster: props.cluster,
        taskDefinition,
        subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        containerOverrides: [
          {
            containerName: 'recon',
            command: [
              '--internal', `s3://${bucket.bucketName}/internal/$(date -u +%Y-%m-%d).csv`,
              '--gateway',  `s3://${bucket.bucketName}/gateway/$(date -u +%Y-%m-%d).csv`,
            ],
          },
        ],
      }),
    );
  }
}