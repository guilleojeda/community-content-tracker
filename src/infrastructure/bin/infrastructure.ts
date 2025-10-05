#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';
import { CognitoStack } from '../lib/stacks/CognitoStack';
import { ApiGatewayStack } from '../lib/stacks/ApiGatewayStack';
import { QueueStack } from '../lib/stacks/QueueStack';
import { ScraperStack } from '../lib/stacks/ScraperStack';
import { PublicApiStack } from '../lib/stacks/PublicApiStack';
import { getEnvironmentConfig } from '../lib/config/environments';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';

// Get configuration from context or environment variables
const domainName = app.node.tryGetContext('domainName') || process.env.DOMAIN_NAME;
const certificateArn = app.node.tryGetContext('certificateArn') || process.env.CERTIFICATE_ARN;

// Capitalize first letter of environment for stack naming
const capitalizeFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const envCapitalized = capitalizeFirst(environment);

// Common stack properties
const commonProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
  },
  description: `Community Content Hub ${environment} infrastructure`,
  tags: {
    Environment: environment,
    Project: 'community-content-hub',
    Owner: 'aws-community',
    CreatedBy: 'cdk',
  },
};

const isProd = environment === 'prod';
const isStaging = environment === 'staging';

// Create Database Stack
const databaseStack = new DatabaseStack(app, `CommunityContentHub-Database-${envCapitalized}`, {
  ...commonProps,
  environment,
  deletionProtection: isProd,
  backupRetentionDays: isProd ? 30 : isStaging ? 14 : 7,
  minCapacity: isProd ? 1 : 0.5,
  maxCapacity: isProd ? 4 : isStaging ? 2 : 1,
});

// Create Static Site Stack
const staticSiteStack = new StaticSiteStack(app, `CommunityContentHub-StaticSite-${envCapitalized}`, {
  ...commonProps,
  environment,
  domainName,
  certificateArn,
  enableWaf: isProd,
});

// Create Cognito Stack
const config = getEnvironmentConfig(environment);
const cognitoStack = new CognitoStack(app, `CommunityContentHub-Cognito-${envCapitalized}`, {
  ...commonProps,
  config,
});

// Note: Lambda functions will be created inline in the API Gateway stack
// to avoid circular dependencies with Cognito stack

// Create Queue Stack for content ingestion
const queueStack = new QueueStack(app, `CommunityContentHub-Queue-${envCapitalized}`, {
  ...commonProps,
  environment,
});

// Create Scraper Stack for content ingestion pipeline
const scraperStack = new ScraperStack(app, `CommunityContentHub-Scraper-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseSecretArn: databaseStack.databaseSecret.secretArn,
  contentProcessingQueue: queueStack.contentProcessingQueue,
  youtubeApiKeySecret: databaseStack.youtubeApiKeySecret,
  githubTokenSecret: databaseStack.githubTokenSecret,
});

// Add dependencies
scraperStack.addDependency(databaseStack);
scraperStack.addDependency(queueStack);

// Create Public API Stack (Sprint 5) for search and stats endpoints
const publicApiStack = new PublicApiStack(app, `CommunityContentHub-PublicApi-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseSecretArn: databaseStack.databaseSecret.secretArn,
  enableTracing: isProd,
});

// Add dependencies
publicApiStack.addDependency(databaseStack);

// Create API Gateway Stack
const apiGatewayStack = new ApiGatewayStack(app, `CommunityContentHub-ApiGateway-${envCapitalized}`, {
  ...commonProps,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
  channelCreateLambda: scraperStack.channelCreateFunction,
  channelListLambda: scraperStack.channelListFunction,
  channelUpdateLambda: scraperStack.channelUpdateFunction,
  channelDeleteLambda: scraperStack.channelDeleteFunction,
  channelSyncLambda: scraperStack.channelSyncFunction,
  searchLambda: publicApiStack.searchFunction,
  statsLambda: publicApiStack.statsFunction,
  environment,
  enableTracing: isProd,
});

// Add dependencies - API Gateway depends on Cognito, Scraper, and Public API stacks
apiGatewayStack.addDependency(cognitoStack);
apiGatewayStack.addDependency(scraperStack);
apiGatewayStack.addDependency(publicApiStack);

// Add metadata to the app
app.node.addMetadata('environment', environment);
app.node.addMetadata('version', '1.0.0');
app.node.addMetadata('sprint', '1');
app.node.addMetadata('description', 'AWS Community Content Hub - Sprint 1 Infrastructure');

console.log(`Synthesizing Community Content Hub infrastructure for environment: ${environment}`);
console.log(`Database Stack: CommunityContentHub-Database-${envCapitalized}`);
console.log(`Static Site Stack: CommunityContentHub-StaticSite-${envCapitalized}`);
console.log(`Cognito Stack: CommunityContentHub-Cognito-${envCapitalized}`);
console.log(`Queue Stack: CommunityContentHub-Queue-${envCapitalized}`);
console.log(`Scraper Stack: CommunityContentHub-Scraper-${envCapitalized}`);
console.log(`Public API Stack: CommunityContentHub-PublicApi-${envCapitalized}`);
console.log(`API Gateway Stack: CommunityContentHub-ApiGateway-${envCapitalized}`);
console.log(`Configuration validated for ${environment} environment`);