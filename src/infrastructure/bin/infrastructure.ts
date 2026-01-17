#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import * as route53 from 'aws-cdk-lib/aws-route53';
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
import { BlueGreenRoutingStack } from '../lib/stacks/BlueGreenRoutingStack';
const app = new cdk.App();

const envCandidates = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const envPath of envCandidates) {
  if (!fs.existsSync(envPath)) {
    continue;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const environment = app.node.tryGetContext('environment')
  || process.env.ENVIRONMENT
  || process.env.STAGE
  || process.env.NEXT_PUBLIC_ENVIRONMENT;
if (!environment || environment.trim().length === 0) {
  throw new Error('Environment must be provided via CDK context (environment) or ENVIRONMENT env var');
}

const parseDatabaseName = (value?: string): string | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const match = value.match(/\/([^/?#]+)(\?|#|$)/);
  return match ? match[1] : undefined;
};

const databaseName = app.node.tryGetContext('databaseName')
  || process.env.DATABASE_NAME
  || process.env.DB_NAME
  || parseDatabaseName(process.env.DATABASE_URL);
if (!databaseName || databaseName.trim().length === 0) {
  throw new Error('DATABASE_NAME must be provided via CDK context (databaseName) or env var');
}

// Get configuration from context or environment variables
const domainName = app.node.tryGetContext('domainName') || process.env.DOMAIN_NAME;
const certificateArn = app.node.tryGetContext('certificateArn') || process.env.CERTIFICATE_ARN;
const blueGreenDomainName = app.node.tryGetContext('blueGreenDomainName')
  || process.env.BLUE_GREEN_DOMAIN_NAME;
const blueGreenHostedZoneId = app.node.tryGetContext('hostedZoneId')
  || process.env.BLUE_GREEN_HOSTED_ZONE_ID
  || process.env.HOSTED_ZONE_ID;
const blueGreenHostedZoneName = app.node.tryGetContext('hostedZoneName')
  || process.env.BLUE_GREEN_HOSTED_ZONE_NAME
  || process.env.HOSTED_ZONE_NAME;
const isBlueGreenEnvironment = ['blue', 'green', 'prod'].includes(environment);
const useBlueGreenRouting = Boolean(blueGreenDomainName) && isBlueGreenEnvironment;

// Capitalize first letter of environment for stack naming
const capitalizeFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const envCapitalized = capitalizeFirst(environment);

const corsOriginEnv = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
if (!corsOriginEnv || corsOriginEnv.trim().length === 0) {
  throw new Error('CORS_ORIGIN must be set');
}

const corsOrigins = corsOriginEnv
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

// Common stack properties
const commonProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,
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

const parseWeight = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid blue/green weight: ${value}`);
  }
  return parsed;
};

const blueWeight = parseWeight(
  app.node.tryGetContext('blueGreenWeightBlue') || process.env.BLUE_GREEN_WEIGHT_BLUE,
  0
);
const greenWeight = parseWeight(
  app.node.tryGetContext('blueGreenWeightGreen') || process.env.BLUE_GREEN_WEIGHT_GREEN,
  100
);

let hostedZone: route53.IHostedZone | undefined;
if (useBlueGreenRouting) {
  if (!blueGreenHostedZoneId || !blueGreenHostedZoneName) {
    throw new Error('BLUE_GREEN_HOSTED_ZONE_ID and BLUE_GREEN_HOSTED_ZONE_NAME must be set for blue/green routing');
  }
  hostedZone = route53.HostedZone.fromHostedZoneAttributes(app, 'BlueGreenHostedZone', {
    hostedZoneId: blueGreenHostedZoneId,
    zoneName: blueGreenHostedZoneName,
  });
}

const resolveStaticSiteDomain = (): string | undefined => {
  if (useBlueGreenRouting && (environment === 'blue' || environment === 'green')) {
    return `${environment}.${blueGreenDomainName}`;
  }
  if (useBlueGreenRouting && environment === 'prod') {
    return undefined;
  }
  return domainName;
};

const staticSiteDomainName = resolveStaticSiteDomain();
const syntheticCheckDomain = staticSiteDomainName || blueGreenDomainName || domainName;


// Create Database Stack
const databaseStack = new DatabaseStack(app, `CommunityContentHub-Database-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseName,
  deletionProtection: config.deletionProtection ?? isProductionLike,
  backupRetentionDays: config.backupRetentionDays ?? (isProductionLike ? 30 : 7),
  minCapacity: config.minCapacity ?? (isProductionLike ? 1 : 0.5),
  maxCapacity: config.maxCapacity ?? (isProductionLike ? 4 : 1),
});
const redisUrl = databaseStack.redisUrl;

// Create Static Site Stack
new StaticSiteStack(app, `CommunityContentHub-StaticSite-${envCapitalized}`, {
  ...commonProps,
  environment,
  domainName: staticSiteDomainName,
  certificateArn,
  enableWaf: config.enableWaf ?? isProductionLike,
  hostedZone,
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
  databaseProxyEndpoint: databaseStack.proxyEndpoint,
  databaseName,
  databasePort: databaseStack.cluster.clusterEndpoint.port,
  redisUrl,
  contentProcessingQueue: queueStack.contentProcessingQueue,
  youtubeApiKeySecret: databaseStack.youtubeApiKeySecret,
  githubTokenSecret: databaseStack.githubTokenSecret,
  vpc: databaseStack.vpc,
  lambdaSecurityGroup: databaseStack.lambdaSecurityGroup,
});

// Add dependencies
scraperStack.addDependency(databaseStack);
scraperStack.addDependency(queueStack);

// Create Public API Stack (Sprint 5) for search and stats endpoints
const publicApiStack = new PublicApiStack(app, `CommunityContentHub-PublicApi-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseSecretArn: databaseStack.databaseSecret.secretArn,
  databaseProxyEndpoint: databaseStack.proxyEndpoint,
  databaseName,
  databasePort: databaseStack.cluster.clusterEndpoint.port,
  redisUrl,
  enableTracing: config.lambda.tracing === 'Active',
  vpc: databaseStack.vpc,
  lambdaSecurityGroup: databaseStack.lambdaSecurityGroup,
});

// Add dependencies
publicApiStack.addDependency(databaseStack);

// Create Application API stack (Sprint 7) for admin, analytics, and exports
const applicationApiStack = new ApplicationApiStack(app, `CommunityContentHub-ApplicationApi-${envCapitalized}`, {
  ...commonProps,
  environment,
  databaseSecretArn: databaseStack.databaseSecret.secretArn,
  databaseProxyEndpoint: databaseStack.proxyEndpoint,
  databaseName,
  databasePort: databaseStack.cluster.clusterEndpoint.port,
  redisUrl,
  enableTracing: config.lambda.tracing === 'Active',
  config,
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
  vpc: databaseStack.vpc,
  lambdaSecurityGroup: databaseStack.lambdaSecurityGroup,
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
  resendVerificationLambda: applicationApiStack.resendVerificationFunction,
  forgotPasswordLambda: applicationApiStack.forgotPasswordFunction,
  resetPasswordLambda: applicationApiStack.resetPasswordFunction,
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
  userGetCurrentLambda: applicationApiStack.userGetCurrentFunction,
  userGetByUsernameLambda: applicationApiStack.userGetByUsernameFunction,
  userContentLambda: applicationApiStack.userContentFunction,
  feedbackIngestLambda: applicationApiStack.feedbackIngestFunction,
  allowedOrigins: corsOrigins,
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
  syntheticCheckUrl: syntheticCheckDomain ? `https://${syntheticCheckDomain}` : undefined,
});

monitoringStack.addDependency(applicationApiStack);
monitoringStack.addDependency(publicApiStack);
monitoringStack.addDependency(databaseStack);
monitoringStack.addDependency(queueStack);

if (useBlueGreenRouting && environment === 'prod') {
  const blueParam = '/blue/static-site/distribution-domain';
  const greenParam = '/green/static-site/distribution-domain';

  const routingStack = new BlueGreenRoutingStack(app, `CommunityContentHub-BlueGreenRouting-${envCapitalized}`, {
    ...commonProps,
    environment,
    rootDomainName: blueGreenDomainName,
    hostedZoneId: blueGreenHostedZoneId,
    hostedZoneName: blueGreenHostedZoneName,
    blueDistributionDomainParam: blueParam,
    greenDistributionDomainParam: greenParam,
    blueWeight,
    greenWeight,
  });

  routingStack.addDependency(databaseStack);
}

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
