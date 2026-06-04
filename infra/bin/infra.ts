#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

const network = new NetworkStack(app, 'PaymentsNetwork', { env });
new AuthStack(app, 'PaymentsAuth', { env });
new DataStack(app, 'PaymentsData', { env, vpc: network.vpc });