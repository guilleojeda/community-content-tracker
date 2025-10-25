import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig } from '../config/environments';

export interface ApplicationApiStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  enableTracing?: boolean;
  config: EnvironmentConfig;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class ApplicationApiStack extends cdk.Stack {
  public readonly authorizerFunction: lambda.Function;
  public readonly registerFunction: lambda.Function;
  public readonly loginFunction: lambda.Function;
  public readonly refreshFunction: lambda.Function;
  public readonly verifyEmailFunction: lambda.Function;
  public readonly adminDashboardFunction: lambda.Function;
  public readonly adminUserManagementFunction: lambda.Function;
  public readonly adminBadgesFunction: lambda.Function;
  public readonly adminModerationFunction: lambda.Function;
  public readonly adminAuditLogFunction: lambda.Function;
  public readonly analyticsTrackFunction: lambda.Function;
  public readonly analyticsUserFunction: lambda.Function;
  public readonly analyticsExportFunction: lambda.Function;
  public readonly exportCsvFunction: lambda.Function;
  public readonly exportHistoryFunction: lambda.Function;
  public readonly contentFindDuplicatesFunction: lambda.Function;
  public readonly contentDetectDuplicatesFunction: lambda.Function;
  public readonly dataRetentionFunction: lambda.Function;
  public readonly userExportFunction: lambda.Function;
  public readonly userDeleteAccountFunction: lambda.Function;
  public readonly userUpdateProfileFunction: lambda.Function;
  public readonly userUpdatePreferencesFunction: lambda.Function;
  public readonly userManageConsentFunction: lambda.Function;
  public readonly userBadgesFunction: lambda.Function;
  public readonly feedbackIngestFunction: lambda.Function;
  public readonly betaFeedbackTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ApplicationApiStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const enableTracing = props.enableTracing ?? true;
    const environmentConfig = props.config;
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(envName);

    const lambdaRuntime = lambda.Runtime.NODEJS_18_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 512;
    const lambdaCodePath = path.join(__dirname, '../../../backend/lambdas');

    const configuredEnv = environmentConfig.lambda.environmentVariables ?? {};
    const normalizedConfiguredEnv = Object.fromEntries(
      Object.entries(configuredEnv)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    );

    const commonEnvironment: Record<string, string> = {
      ...normalizedConfiguredEnv,
      DATABASE_SECRET_ARN: props.databaseSecretArn,
      ENVIRONMENT: envName,
      ENABLE_BETA_FEATURES: process.env.ENABLE_BETA_FEATURES ?? (envName === 'beta' ? 'true' : 'false'),
    };

    commonEnvironment.COGNITO_USER_POOL_ID = props.userPool.userPoolId;
    commonEnvironment.COGNITO_CLIENT_ID = props.userPoolClient.userPoolClientId;
    commonEnvironment.COGNITO_REGION = this.region;
    if (!commonEnvironment.ALLOWED_AUDIENCES) {
      commonEnvironment.ALLOWED_AUDIENCES = props.userPoolClient.userPoolClientId;
    }

    if (!commonEnvironment.CORS_ORIGIN && process.env.CORS_ORIGIN) {
      commonEnvironment.CORS_ORIGIN = process.env.CORS_ORIGIN;
    }

    const adminRole = new iam.Role(this, 'AdminApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    adminRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [props.databaseSecretArn],
      })
    );

    adminRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    adminRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:SignUp',
          'cognito-idp:ConfirmSignUp',
          'cognito-idp:InitiateAuth',
          'cognito-idp:RespondToAuthChallenge',
          'cognito-idp:DeleteUser',
          'cognito-idp:ForgotPassword',
          'cognito-idp:ConfirmForgotPassword'
        ],
        resources: ['*'],
      })
    );

    const tracing = enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED;

    const createLambda = (logicalId: string, handler: string, overrides: Partial<lambda.FunctionProps> = {}) => {
      const fn = new lambda.Function(this, logicalId, {
        functionName: `community-content-tracker-${envName}-${logicalId.toLowerCase()}`,
        runtime: lambdaRuntime,
        handler,
        code: lambda.Code.fromAsset(lambdaCodePath),
        timeout: overrides.timeout ?? lambdaTimeout,
        memorySize: overrides.memorySize ?? lambdaMemory,
        environment: {
          ...commonEnvironment,
          ...(overrides.environment ?? {}),
        },
        role: overrides.role ?? adminRole,
        description: overrides.description,
        tracing,
      });

      new logs.LogRetention(this, `${logicalId}Retention`, {
        logGroupName: fn.logGroup.logGroupName,
        retention: logs.RetentionDays.ONE_WEEK,
        logGroupRegion: this.region,
      });

      return fn;
    };

    this.authorizerFunction = createLambda('AuthorizerFunction', 'auth/authorizer.handler', {
      description: 'JWT token authorizer for API Gateway',
    });

    this.registerFunction = createLambda('RegisterFunction', 'auth/register.handler', {
      description: 'User registration endpoint',
    });

    this.loginFunction = createLambda('LoginFunction', 'auth/login.handler', {
      description: 'User login endpoint',
    });

    this.refreshFunction = createLambda('RefreshFunction', 'auth/refresh.handler', {
      description: 'Token refresh endpoint',
    });

    this.verifyEmailFunction = createLambda('VerifyEmailFunction', 'auth/verify-email.handler', {
      description: 'Email verification endpoint',
    });

    this.adminDashboardFunction = createLambda('AdminDashboardFunction', 'admin/admin-dashboard.handler', {
      description: 'Admin dashboard statistics and system health',
    });

    this.adminUserManagementFunction = createLambda('AdminUserManagementFunction', 'admin/user-management.handler', {
      description: 'Admin user management endpoints',
    });

    this.adminBadgesFunction = createLambda('AdminBadgesFunction', 'admin/badges.handler', {
      description: 'Admin badge operations and AWS employee flagging',
    });

    this.adminModerationFunction = createLambda('AdminModerationFunction', 'admin/moderate-content.handler', {
      description: 'Admin content moderation endpoints',
      timeout: cdk.Duration.seconds(45),
    });

    this.adminAuditLogFunction = createLambda('AdminAuditLogFunction', 'admin/audit-log.handler', {
      description: 'Admin action audit log retrieval',
    });

    this.analyticsTrackFunction = createLambda('AnalyticsTrackFunction', 'analytics/track-event.handler', {
      description: 'Analytics event tracking endpoint',
    });

    this.analyticsUserFunction = createLambda('AnalyticsUserFunction', 'analytics/user-analytics.handler', {
      description: 'Authenticated user analytics endpoint',
    });

    this.analyticsExportFunction = createLambda('AnalyticsExportFunction', 'analytics/export-analytics.handler', {
      description: 'Analytics CSV export endpoint',
    });

    this.exportCsvFunction = createLambda('ProgramExportFunction', 'export/csv-export.handler', {
      description: 'Program-specific content export',
    });

    this.exportHistoryFunction = createLambda('ExportHistoryFunction', 'export/history.handler', {
      description: 'Export history retrieval endpoint',
    });

    this.userExportFunction = createLambda('UserExportFunction', 'users/export-data.handler', {
      description: 'GDPR data export endpoint for authenticated users',
    });

    this.userDeleteAccountFunction = createLambda('UserDeleteAccountFunction', 'users/delete-account.handler', {
      description: 'GDPR account deletion endpoint for authenticated users',
    });

    this.userUpdateProfileFunction = createLambda('UserUpdateProfileFunction', 'users/update-profile.handler', {
      description: 'User profile update (right to rectification)',
    });

    this.userUpdatePreferencesFunction = createLambda('UserUpdatePreferencesFunction', 'users/update-preferences.handler', {
      description: 'User communication preferences update endpoint',
    });

    this.userManageConsentFunction = createLambda('UserManageConsentFunction', 'user/manage-consent.handler', {
      description: 'User consent management endpoint',
    });

    this.userBadgesFunction = createLambda('UserBadgesFunction', 'users/get-badges.handler', {
      description: 'Public user badges retrieval endpoint',
    });

    this.betaFeedbackTable = new dynamodb.Table(this, 'BetaFeedbackTable', {
      tableName: `community-content-hub-${envName}-feedback`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'submittedAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProductionLike ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: envName !== 'dev',
      },
    });

    this.feedbackIngestFunction = createLambda('FeedbackIngestFunction', 'feedback/ingest.handler', {
      description: 'Beta feedback ingestion endpoint',
      environment: {
        FEEDBACK_TABLE_NAME: this.betaFeedbackTable.tableName,
      },
    });

    this.betaFeedbackTable.grantWriteData(this.feedbackIngestFunction);

    this.dataRetentionFunction = createLambda('DataRetentionFunction', 'maintenance/data-retention.handler', {
      description: 'Analytics data retention cleanup',
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        ANALYTICS_RETENTION_DAYS: process.env.ANALYTICS_RETENTION_DAYS ?? '730',
      },
    });

    this.contentFindDuplicatesFunction = createLambda('ContentFindDuplicatesFunction', 'content/find-duplicates.handler', {
      description: 'Duplicate detection API for contributors',
      timeout: cdk.Duration.minutes(2),
    });

    this.contentDetectDuplicatesFunction = createLambda('ContentDetectDuplicatesFunction', 'content/detect-duplicates.handler', {
      description: 'Scheduled duplicate detection job',
      timeout: cdk.Duration.minutes(5),
    });

    const duplicateSchedule = new events.Rule(this, 'DuplicateDetectionSchedule', {
      ruleName: `duplicate-detection-${envName}`,
      description: 'Periodic duplicate detection',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '3',
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: envName !== 'dev',
    });

    duplicateSchedule.addTarget(new targets.LambdaFunction(this.contentDetectDuplicatesFunction));

    const retentionSchedule = new events.Rule(this, 'DataRetentionSchedule', {
      ruleName: `analytics-retention-${envName}`,
      description: 'Scheduled analytics data retention enforcement',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    retentionSchedule.addTarget(new targets.LambdaFunction(this.dataRetentionFunction));

    new cdk.CfnOutput(this, 'AdminDashboardLambdaArn', {
      value: this.adminDashboardFunction.functionArn,
      description: 'Admin dashboard Lambda ARN',
      exportName: `community-content-tracker-admin-dashboard-${envName}`,
    });

    cdk.Tags.of(this).add('Project', 'CommunityContentTracker');
    cdk.Tags.of(this).add('Component', 'ApplicationApi');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('Sprint', '8');
  }
}
