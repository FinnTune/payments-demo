import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  Port,
  SecurityGroup,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface DataStackProps extends StackProps {
  vpc: IVpc;
}

/**
 * RDS Postgres in the VPC's isolated subnets, with credentials in
 * Secrets Manager. The service stack will grant the application task
 * read access to the secret.
 *
 * Single AZ, single instance for the demo. Real production would
 * enable multi-AZ for automatic failover and read replicas for
 * scaling read traffic.
 */
export class DataStack extends Stack {
  public readonly database: DatabaseInstance;
  public readonly credentialsSecret: Secret;
  public readonly databaseSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // ---------- Credentials secret ----------
    // Secrets Manager generates the password; nothing here or in
    // version control ever sees the plaintext.
    this.credentialsSecret = new Secret(this, 'PaymentsDbCredentials', {
      secretName: 'payments/db-credentials',
      description: 'Postgres credentials for the payments service',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'payments' }),
        generateStringKey: 'password',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
        passwordLength: 32,
      },
      removalPolicy: RemovalPolicy.DESTROY,  // demo only
    });

    // ---------- Security group ----------
    // Starts closed — explicitly allows the application's SG later.
    this.databaseSecurityGroup = new SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: props.vpc,
      description: 'Allow Postgres traffic from the payments service',
      allowAllOutbound: false,
    });

    // ---------- RDS Postgres ----------
    this.database = new DatabaseInstance(this, 'PaymentsDatabase', {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_16_4,
      }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.databaseSecurityGroup],

      credentials: Credentials.fromSecret(this.credentialsSecret),
      databaseName: 'payments',
      port: 5432,

      // Storage
      allocatedStorage: 20,                  // GB; can grow to allocatedMax
      maxAllocatedStorage: 100,
      storageType: StorageType.GP3,
      storageEncrypted: true,                // AWS-managed KMS key

      // Backups, observability
      backupRetention: Duration.days(7),
      deletionProtection: false,             // demo only
      enablePerformanceInsights: true,
      performanceInsightRetention: 7,        // days; 7 is free, 731 is paid

      // Maintenance windows (UTC). Picks a slot when traffic is lowest
      // in Helsinki. Adjust per real workload patterns.
      preferredBackupWindow: '02:00-03:00',
      preferredMaintenanceWindow: 'sun:03:00-sun:04:00',

      // Single AZ for the demo; multiAz=true gives synchronous
      // standby in another AZ for HA. Roughly doubles cost.
      multiAz: false,

      // Demo posture: nuke on stack destroy. Production: SNAPSHOT
      // (takes a final backup) or RETAIN (DB stays, stack forgets).
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}