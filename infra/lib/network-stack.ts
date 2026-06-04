import { Stack, StackProps } from 'aws-cdk-lib';
import {
  IpAddresses,
  IpProtocol,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * The network stack defines the VPC and its subnets — the foundation
 * every other stack builds on.
 *
 * Layout: 3 AZs × 3 subnet types (public, private-with-egress, isolated).
 * One NAT gateway per AZ for resilience. Resources in private subnets
 * can reach the internet for outbound traffic (pulling container images,
 * calling external APIs) but aren't reachable from outside.
 */
export class NetworkStack extends Stack {
  public readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'PaymentsVpc', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
      ipProtocol: IpProtocol.IPV4_ONLY,
      maxAzs: 3,
      natGateways: 3,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
        {
          name: 'isolated',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 22,
        },
      ],
    });
  }
}