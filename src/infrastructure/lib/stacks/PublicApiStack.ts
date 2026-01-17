import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

export interface PublicApiStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  databaseProxyEndpoint: string;
  databaseName: string;
  databasePort?: number;
  redisUrl: string;
  enableTracing?: boolean;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
}

/**
 * Stack for public API Lambda functions (search, stats)
 * These are Sprint 5 endpoints that don't require authentication
 */
export class PublicApiStack extends cdk.Stack {
  public readonly searchFunction: lambda.Function;
  public readonly statsFunction: lambda.Function;
  public readonly searchIntegration: lambda.IFunction;
  public readonly statsIntegration: lambda.IFunction;

  constructor(scope: Construct, id: string, props: PublicApiStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const enableTracing = props.enableTracing ?? true;
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(envName);
    const databasePort = props.databasePort ?? 5432;

    // Common Lambda configuration
    const lambdaRuntime = lambda.Runtime.NODEJS_18_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 512;
    const depsLockFilePath = path.join(__dirname, '../../../../package-lock.json');
    const lambdaEntryPath = path.join(__dirname, '../../../backend/lambdas');

    // Database connection configuration from environment
    const databaseConfig: Record<string, string> = {
      DATABASE_SECRET_ARN: props.databaseSecretArn,
      DB_HOST: props.databaseProxyEndpoint,
      DB_PORT: String(databasePort),
      DB_NAME: props.databaseName,
      REDIS_URL: props.redisUrl,
      NODE_ENV: envName,
      ENABLE_BETA_FEATURES: requireEnv('ENABLE_BETA_FEATURES'),
      CORS_ORIGIN: requireEnv('CORS_ORIGIN'),
      CORS_ALLOW_HEADERS: requireEnv('CORS_ALLOW_HEADERS'),
      CORS_ALLOW_METHODS: requireEnv('CORS_ALLOW_METHODS'),
      CORS_MAX_AGE: requireEnv('CORS_MAX_AGE'),
      DATABASE_POOL_MIN: requireEnv('DATABASE_POOL_MIN'),
      DATABASE_POOL_MAX: requireEnv('DATABASE_POOL_MAX'),
      DATABASE_POOL_IDLE_TIMEOUT_MS: requireEnv('DATABASE_POOL_IDLE_TIMEOUT_MS'),
      DATABASE_POOL_CONNECTION_TIMEOUT_MS: requireEnv('DATABASE_POOL_CONNECTION_TIMEOUT_MS'),
      RATE_LIMIT_ANONYMOUS: requireEnv('RATE_LIMIT_ANONYMOUS'),
      RATE_LIMIT_AUTHENTICATED: requireEnv('RATE_LIMIT_AUTHENTICATED'),
      RATE_LIMIT_WINDOW_MINUTES: requireEnv('RATE_LIMIT_WINDOW_MINUTES'),
    };
    if (process.env.CORS_CREDENTIALS) {
      databaseConfig.CORS_CREDENTIALS = process.env.CORS_CREDENTIALS;
    }

    // Search Lambda Function
    this.searchFunction = new NodejsFunction(this, 'SearchFunction', {
      functionName: `community-content-tracker-${envName}-search`,
      runtime: lambdaRuntime,
      entry: path.join(lambdaEntryPath, 'search/search.ts'),
      handler: 'handler',
      depsLockFilePath,
      timeout: lambdaTimeout,
      memorySize: lambdaMemory,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        ...databaseConfig,
        BEDROCK_REGION: requireEnv('BEDROCK_REGION'),
        BEDROCK_MODEL_ID: requireEnv('BEDROCK_MODEL_ID'),
        RATE_LIMIT_ANONYMOUS: requireEnv('RATE_LIMIT_ANONYMOUS'),
        RATE_LIMIT_AUTHENTICATED: requireEnv('RATE_LIMIT_AUTHENTICATED'),
        RATE_LIMIT_WINDOW_MINUTES: requireEnv('RATE_LIMIT_WINDOW_MINUTES'),
      },
      description: 'Search endpoint with semantic and keyword search',
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    // Stats Lambda Function
    this.statsFunction = new NodejsFunction(this, 'StatsFunction', {
      functionName: `community-content-tracker-${envName}-stats`,
      runtime: lambdaRuntime,
      entry: path.join(lambdaEntryPath, 'stats/platform-stats.ts'),
      handler: 'handler',
      depsLockFilePath,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        ...databaseConfig,
        STATS_CACHE_TTL: requireEnv('STATS_CACHE_TTL'),
      },
      description: 'Platform statistics endpoint',
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    const useProvisionedConcurrency = isProductionLike || envName === 'beta';

    if (useProvisionedConcurrency) {
      const baseProvisioned = isProductionLike ? 5 : 1;
      const searchAlias = new lambda.Alias(this, 'SearchFunctionAlias', {
        aliasName: `${envName}-live`,
        version: this.searchFunction.currentVersion,
        provisionedConcurrentExecutions: baseProvisioned,
      });

      const scaling = searchAlias.addAutoScaling({
        minCapacity: baseProvisioned,
        maxCapacity: isProductionLike ? 30 : 5,
      });
      scaling.scaleOnUtilization({ utilizationTarget: 0.75 });

      this.searchIntegration = searchAlias;
    } else {
      this.searchIntegration = this.searchFunction;
    }

    this.statsIntegration = this.statsFunction;

    new logs.LogRetention(this, 'SearchFunctionRetention', {
      logGroupName: this.searchFunction.logGroup.logGroupName,
      retention: logs.RetentionDays.ONE_WEEK,
      logGroupRegion: this.region,
    });

    new logs.LogRetention(this, 'StatsFunctionRetention', {
      logGroupName: this.statsFunction.logGroup.logGroupName,
      retention: logs.RetentionDays.ONE_WEEK,
      logGroupRegion: this.region,
    });

    // Grant Bedrock permissions to search function
    this.searchFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
        ],
        resources: [
          `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v1`,
        ],
      })
    );

    // Grant CloudWatch permissions for metrics
    [this.searchFunction, this.statsFunction].forEach(fn => {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cloudwatch:PutMetricData',
          ],
          resources: ['*'],
        })
      );

      // Grant Secrets Manager permissions for database credentials
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'secretsmanager:GetSecretValue',
          ],
          resources: [props.databaseSecretArn],
        })
      );
    });

    // Outputs
    new cdk.CfnOutput(this, 'SearchFunctionArn', {
      value: this.searchFunction.functionArn,
      description: 'Search Lambda function ARN',
      exportName: `community-content-tracker-search-function-arn-${envName}`,
    });

    new cdk.CfnOutput(this, 'StatsFunctionArn', {
      value: this.statsFunction.functionArn,
      description: 'Stats Lambda function ARN',
      exportName: `community-content-tracker-stats-function-arn-${envName}`,
    });

    // Add tags
    cdk.Tags.of(this).add('Project', 'CommunityContentTracker');
    cdk.Tags.of(this).add('Component', 'PublicApi');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('Sprint', '8');
  }
}
