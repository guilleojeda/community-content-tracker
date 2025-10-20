import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PublicApiStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  enableTracing?: boolean;
}

/**
 * Stack for public API Lambda functions (search, stats)
 * These are Sprint 5 endpoints that don't require authentication
 */
export class PublicApiStack extends cdk.Stack {
  public readonly searchFunction: lambda.Function;
  public readonly statsFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: PublicApiStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const enableTracing = props.enableTracing ?? true;

    // Common Lambda configuration
    const lambdaRuntime = lambda.Runtime.NODEJS_18_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 512;

    // Database connection configuration from environment
    const databaseConfig = {
      DB_HOST: process.env.DB_HOST || 'localhost',
      DB_PORT: process.env.DB_PORT || '5432',
      DB_NAME: process.env.DB_NAME || 'community_content_hub',
      DB_SECRET_ARN: props.databaseSecretArn,
      NODE_ENV: envName,
    };

    // Search Lambda Function
    this.searchFunction = new lambda.Function(this, 'SearchFunction', {
      functionName: `community-content-tracker-${envName}-search`,
      runtime: lambdaRuntime,
      handler: 'search.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../backend/lambdas/search')
      ),
      timeout: lambdaTimeout,
      memorySize: lambdaMemory,
      environment: {
        ...databaseConfig,
        BEDROCK_REGION: process.env.BEDROCK_REGION || cdk.Aws.REGION,
      },
      description: 'Search endpoint with semantic and keyword search',
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    // Stats Lambda Function
    this.statsFunction = new lambda.Function(this, 'StatsFunction', {
      functionName: `community-content-tracker-${envName}-stats`,
      runtime: lambdaRuntime,
      handler: 'platform-stats.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../../backend/lambdas/stats')
      ),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: databaseConfig,
      description: 'Platform statistics endpoint',
      tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

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
    cdk.Tags.of(this).add('Sprint', '5');
  }
}
