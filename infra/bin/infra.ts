#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { ServiceStack } from '../lib/service-stack';
import { ReconStack } from '../lib/recon-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

const network = new NetworkStack(app, 'PaymentsNetwork', { env });
const auth = new AuthStack(app, 'PaymentsAuth', { env });
const data = new DataStack(app, 'PaymentsData', { env, vpc: network.vpc });

const service = new ServiceStack(app, 'PaymentsService', {
  env,
  vpc: network.vpc,
  database: data.database,
  credentialsSecret: data.credentialsSecret,
  databaseSecurityGroup: data.databaseSecurityGroup,
  jwtIssuerUri: auth.issuerUrl,
});

new ReconStack(app, 'PaymentsRecon', {
  env,
  vpc: network.vpc,
  cluster: service.cluster,
});