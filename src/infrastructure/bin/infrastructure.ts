#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';
import { CognitoStack } from '../lib/stacks/CognitoStack';
import { ApiGatewayStack } from '../lib/stacks/ApiGatewayStack';
import { ApplicationApiStack } from '../lib/stacks/ApplicationApiStack';
import { QueueStack } from '../lib/stacks/QueueStack';
import { ScraperStack } from '../lib/stacks/ScraperStack';
import { PublicApiStack } from '../lib/stacks/PublicApiStack';
import { MonitoringStack } from '../lib/stacks/MonitoringStack';
import { getEnvironmentConfig } from '../lib/config/environments';
const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || 'dev';

// Get configuration from context or environment variables
const domainName = app.node.tryGetContext('domainName') || process.env.DOMAIN_NAME;
const certificateArn = app.node.tryGetContext('certificateArn') || process.env.CERTIFICATE_ARN;

// Capitalize first letter of environment for stack naming
const capitalizeFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const envCapitalized = capitalizeFirst(environment);

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

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

const config = getEnvironmentConfig(environment);
const isProductionLike = config.isProductionLike === true;
const isBeta = environment === 'beta';

// Create Database Stack
const databaseStack = new DatabaseStack(app, `CommunityContentHub-Database-${envCapitalized}`, {
  ...commonProps,
  environment,
  deletionProtection: config.deletionProtection ?? isProductionLike,
  backupRetentionDays: config.backupRetentionDays ?? (isProductionLike ? 30 : 7),
  minCapacity: config.minCapacity ?? (isProductionLike ? 1 : 0.5),
  maxCapacity: config.maxCapacity ?? (isProductionLike ? 4 : 1),
});

// Create Static Site Stack
const staticSiteStack = new StaticSiteStack(app, `CommunityContentHub-StaticSite-${envCapitalized}`, {
  ...commonProps,
  environment,
  domainName,
  certificateArn,
  enableWaf: config.enableWaf ?? isProductionLike,
});

// Create Cognito Stack
const cognitoStack = new CognitoStack(app, `CommunityContentHub-Cognito-${envCapitalized}`, {
  ...commonProps,
  config,
});

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
  enableTracing: config.lambda.tracing === 'Active',
});

// Add dependencies
publicApiStack.addDependency(databaseStack);

// Create Application API stack (Sprint 7) for admin, analytics, and exports
const applicationApiStack = new ApplicationApiStack(app, `CommunityContentHub-ApplicationApi-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseSecretArn: databaseStack.databaseSecret.secretArn,
  enableTracing: config.lambda.tracing === 'Active',
  config,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
});

applicationApiStack.addDependency(databaseStack);

// Create API Gateway Stack
const apiGatewayStack = new ApiGatewayStack(app, `CommunityContentHub-ApiGateway-${envCapitalized}`, {
  ...commonProps,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
  authorizerLambda: applicationApiStack.authorizerFunction,
  registerLambda: applicationApiStack.registerFunction,
  loginLambda: applicationApiStack.loginFunction,
  refreshLambda: applicationApiStack.refreshFunction,
  verifyEmailLambda: applicationApiStack.verifyEmailFunction,
  channelCreateLambda: scraperStack.channelCreateFunction,
  channelListLambda: scraperStack.channelListFunction,
  channelUpdateLambda: scraperStack.channelUpdateFunction,
  channelDeleteLambda: scraperStack.channelDeleteFunction,
  channelSyncLambda: scraperStack.channelSyncFunction,
  searchLambda: publicApiStack.searchIntegration,
  statsLambda: publicApiStack.statsIntegration,
  environment,
  enableTracing: (config.lambda.tracing === 'Active') || isBeta,
  adminDashboardLambda: applicationApiStack.adminDashboardFunction,
  adminUserManagementLambda: applicationApiStack.adminUserManagementFunction,
  adminBadgesLambda: applicationApiStack.adminBadgesFunction,
  adminModerationLambda: applicationApiStack.adminModerationFunction,
  adminAuditLogLambda: applicationApiStack.adminAuditLogFunction,
  analyticsTrackLambda: applicationApiStack.analyticsTrackFunction,
  analyticsUserLambda: applicationApiStack.analyticsUserFunction,
  analyticsExportLambda: applicationApiStack.analyticsExportFunction,
  exportCsvLambda: applicationApiStack.exportCsvFunction,
  exportHistoryLambda: applicationApiStack.exportHistoryFunction,
  contentFindDuplicatesLambda: applicationApiStack.contentFindDuplicatesFunction,
  userExportLambda: applicationApiStack.userExportFunction,
  userDeleteAccountLambda: applicationApiStack.userDeleteAccountFunction,
  userUpdateProfileLambda: applicationApiStack.userUpdateProfileFunction,
  userUpdatePreferencesLambda: applicationApiStack.userUpdatePreferencesFunction,
  userManageConsentLambda: applicationApiStack.userManageConsentFunction,
  userBadgesLambda: applicationApiStack.userBadgesFunction,
  feedbackIngestLambda: applicationApiStack.feedbackIngestFunction,
  allowedOrigins: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
});

// Add dependencies - API Gateway depends on Cognito, Scraper, and Public API stacks
apiGatewayStack.addDependency(cognitoStack);
apiGatewayStack.addDependency(scraperStack);
apiGatewayStack.addDependency(publicApiStack);

const monitoringStack = new MonitoringStack(app, `CommunityContentHub-Monitoring-${envCapitalized}`, {
  ...commonProps,
  environment,
  searchFunction: publicApiStack.searchFunction,
  statsFunction: publicApiStack.statsFunction,
  analyticsTrackFunction: applicationApiStack.analyticsTrackFunction,
  analyticsUserFunction: applicationApiStack.analyticsUserFunction,
  analyticsExportFunction: applicationApiStack.analyticsExportFunction,
  dataRetentionFunction: applicationApiStack.dataRetentionFunction,
  userExportFunction: applicationApiStack.userExportFunction,
  userDeleteAccountFunction: applicationApiStack.userDeleteAccountFunction,
  userManageConsentFunction: applicationApiStack.userManageConsentFunction,
  feedbackIngestFunction: applicationApiStack.feedbackIngestFunction,
  databaseCluster: databaseStack.cluster,
  databaseProxy: databaseStack.proxy,
  contentQueue: queueStack.contentProcessingQueue,
  contentDeadLetterQueue: queueStack.contentProcessingDLQ,
  syntheticCheckUrl: domainName ? `https://${domainName}` : undefined,
});

monitoringStack.addDependency(applicationApiStack);
monitoringStack.addDependency(publicApiStack);
monitoringStack.addDependency(databaseStack);
monitoringStack.addDependency(queueStack);

// Add metadata to the app
app.node.addMetadata('environment', environment);
app.node.addMetadata('version', '1.0.0');
app.node.addMetadata('sprint', '8');
app.node.addMetadata('description', 'AWS Community Content Hub - Sprint 7 Infrastructure');

console.log(`Synthesizing Community Content Hub infrastructure for environment: ${environment}`);
console.log(`Database Stack: CommunityContentHub-Database-${envCapitalized}`);
console.log(`Static Site Stack: CommunityContentHub-StaticSite-${envCapitalized}`);
console.log(`Cognito Stack: CommunityContentHub-Cognito-${envCapitalized}`);
console.log(`Queue Stack: CommunityContentHub-Queue-${envCapitalized}`);
console.log(`Scraper Stack: CommunityContentHub-Scraper-${envCapitalized}`);
console.log(`Public API Stack: CommunityContentHub-PublicApi-${envCapitalized}`);
console.log(`Application API Stack: CommunityContentHub-ApplicationApi-${envCapitalized}`);
console.log(`API Gateway Stack: CommunityContentHub-ApiGateway-${envCapitalized}`);
console.log(`Monitoring Stack: CommunityContentHub-Monitoring-${envCapitalized}`);
console.log(`Configuration validated for ${environment} environment`);
