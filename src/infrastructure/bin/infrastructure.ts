#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CommunityContentApp } from '../lib/community-content-app';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';

// Get configuration from context or environment variables
const domainName = app.node.tryGetContext('domainName') || process.env.DOMAIN_NAME;
const certificateArn = app.node.tryGetContext('certificateArn') || process.env.CERTIFICATE_ARN;

// Create the main application with all stacks
const communityApp = new CommunityContentApp(app, 'CommunityContentHub', {
  environment,
  domainName,
  certificateArn,
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
  enableWaf: environment === 'prod',
});

// Add metadata to the app
app.node.addMetadata('environment', environment);
app.node.addMetadata('version', '1.0.0');
app.node.addMetadata('sprint', '1');
app.node.addMetadata('description', 'AWS Community Content Hub - Sprint 1 Infrastructure');

console.log(`Synthesizing Community Content Hub infrastructure for environment: ${environment}`);
console.log(`Database Stack: ${communityApp.databaseStack.stackName}`);
console.log(`Static Site Stack: ${communityApp.staticSiteStack.stackName}`);
console.log(`Configuration validated for ${environment} environment`);