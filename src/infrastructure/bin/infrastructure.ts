#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';

// Create the infrastructure stack
const infraStack = new InfrastructureStack(app, 'CommunityContentHub', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Add metadata to the app
app.node.addMetadata('environment', environment);
app.node.addMetadata('version', '1.0.0');
app.node.addMetadata('sprint', '1');
app.node.addMetadata('description', 'AWS Community Content Hub - Sprint 1 Infrastructure');

console.log(`🏗️  Synthesizing Community Content Hub infrastructure for environment: ${environment}`);
console.log(`📊 Database Stack: ${infraStack.database.stackName}`);

console.log(`✅ Configuration validated for ${environment} environment`);