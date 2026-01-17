import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig } from '../config/environments';

export interface ApplicationApiStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  databaseProxyEndpoint: string;
  databaseName: string;
  databasePort?: number;
  redisUrl: string;
  enableTracing?: boolean;
  config: EnvironmentConfig;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
}

export class ApplicationApiStack extends cdk.Stack {
  public readonly authorizerFunction: lambda.Function;
  public readonly registerFunction: lambda.Function;
  public readonly loginFunction: lambda.Function;
  public readonly refreshFunction: lambda.Function;
  public readonly verifyEmailFunction: lambda.Function;
  public readonly resendVerificationFunction: lambda.Function;
  public readonly forgotPasswordFunction: lambda.Function;
  public readonly resetPasswordFunction: lambda.Function;
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
  public readonly userGetCurrentFunction: lambda.Function;
  public readonly userGetByUsernameFunction: lambda.Function;
  public readonly userContentFunction: lambda.Function;
  public readonly feedbackIngestFunction: lambda.Function;
  public readonly betaFeedbackTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ApplicationApiStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const enableTracing = props.enableTracing ?? true;
    const environmentConfig = props.config;
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(envName);
    const databasePort = props.databasePort ?? 5432;

    const lambdaRuntime = lambda.Runtime.NODEJS_18_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 512;
    const lambdaEntryPath = path.join(__dirname, '../../../backend/lambdas');
    const depsLockFilePath = path.join(__dirname, '../../../../package-lock.json');

    const configuredEnv = environmentConfig.lambda.environmentVariables ?? {};
    const normalizedConfiguredEnv = Object.fromEntries(
      Object.entries(configuredEnv)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    );

    const requireEnv = (name: string): string => {
      const value = normalizedConfiguredEnv[name] ?? process.env[name];
      if (!value || value.trim().length === 0) {
        throw new Error(`${name} must be set`);
      }
      return value;
    };

    const commonEnvironment: Record<string, string> = {
      ...normalizedConfiguredEnv,
      DATABASE_SECRET_ARN: props.databaseSecretArn,
      DB_HOST: props.databaseProxyEndpoint,
      DB_PORT: String(databasePort),
      DB_NAME: props.databaseName,
      REDIS_URL: props.redisUrl,
      ENVIRONMENT: envName,
      ENABLE_BETA_FEATURES: requireEnv('ENABLE_BETA_FEATURES'),
      CORS_ORIGIN: requireEnv('CORS_ORIGIN'),
      CORS_ALLOW_HEADERS: requireEnv('CORS_ALLOW_HEADERS'),
      CORS_ALLOW_METHODS: requireEnv('CORS_ALLOW_METHODS'),
      CORS_MAX_AGE: requireEnv('CORS_MAX_AGE'),
      AUTH_RATE_LIMIT_PER_MINUTE: requireEnv('AUTH_RATE_LIMIT_PER_MINUTE'),
      RATE_LIMIT_ANONYMOUS: requireEnv('RATE_LIMIT_ANONYMOUS'),
      RATE_LIMIT_AUTHENTICATED: requireEnv('RATE_LIMIT_AUTHENTICATED'),
      RATE_LIMIT_WINDOW_MINUTES: requireEnv('RATE_LIMIT_WINDOW_MINUTES'),
      TOKEN_VERIFICATION_TIMEOUT_MS: requireEnv('TOKEN_VERIFICATION_TIMEOUT_MS'),
      MFA_TOTP_SEED: requireEnv('MFA_TOTP_SEED'),
      DATABASE_POOL_MIN: requireEnv('DATABASE_POOL_MIN'),
      DATABASE_POOL_MAX: requireEnv('DATABASE_POOL_MAX'),
      DATABASE_POOL_IDLE_TIMEOUT_MS: requireEnv('DATABASE_POOL_IDLE_TIMEOUT_MS'),
      DATABASE_POOL_CONNECTION_TIMEOUT_MS: requireEnv('DATABASE_POOL_CONNECTION_TIMEOUT_MS'),
    };

    commonEnvironment.COGNITO_USER_POOL_ID = props.userPool.userPoolId;
    commonEnvironment.COGNITO_CLIENT_ID = props.userPoolClient.userPoolClientId;
    commonEnvironment.COGNITO_REGION = this.region;
    if (!commonEnvironment.ALLOWED_AUDIENCES) {
      commonEnvironment.ALLOWED_AUDIENCES = props.userPoolClient.userPoolClientId;
    }

    if (process.env.CORS_CREDENTIALS) {
      commonEnvironment.CORS_CREDENTIALS = process.env.CORS_CREDENTIALS;
    }

    const adminRole = new iam.Role(this, 'AdminApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
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

    const createLambda = (logicalId: string, entry: string, overrides: Partial<NodejsFunctionProps> = {}) => {
      const fn = new NodejsFunction(this, logicalId, {
        functionName: `community-content-tracker-${envName}-${logicalId.toLowerCase()}`,
        runtime: lambdaRuntime,
        entry: path.join(lambdaEntryPath, entry),
        handler: 'handler',
        depsLockFilePath,
        timeout: overrides.timeout ?? lambdaTimeout,
        memorySize: overrides.memorySize ?? lambdaMemory,
        vpc: overrides.vpc ?? props.vpc,
        vpcSubnets: overrides.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: overrides.securityGroups ?? [props.lambdaSecurityGroup],
        environment: {
          ...commonEnvironment,
          ...(overrides.environment ?? {}),
        },
        role: overrides.role ?? adminRole,
        description: overrides.description,
        bundling: {
          target: 'node18',
          sourceMap: true,
          ...(overrides.bundling ?? {}),
        },
        tracing,
      });

      new logs.LogRetention(this, `${logicalId}Retention`, {
        logGroupName: fn.logGroup.logGroupName,
        retention: logs.RetentionDays.ONE_WEEK,
        logGroupRegion: this.region,
      });

      return fn;
    };

    this.authorizerFunction = createLambda('AuthorizerFunction', 'auth/authorizer.ts', {
      description: 'JWT token authorizer for API Gateway',
    });

    this.registerFunction = createLambda('RegisterFunction', 'auth/register.ts', {
      description: 'User registration endpoint',
    });

    this.loginFunction = createLambda('LoginFunction', 'auth/login.ts', {
      description: 'User login endpoint',
    });

    this.refreshFunction = createLambda('RefreshFunction', 'auth/refresh.ts', {
      description: 'Token refresh endpoint',
    });

    this.verifyEmailFunction = createLambda('VerifyEmailFunction', 'auth/verify-email.ts', {
      description: 'Email verification endpoint',
    });

    this.resendVerificationFunction = createLambda('ResendVerificationFunction', 'auth/resend-verification.ts', {
      description: 'Resend email verification code endpoint',
    });

    this.forgotPasswordFunction = createLambda('ForgotPasswordFunction', 'auth/forgot-password.ts', {
      description: 'Forgot password endpoint',
    });

    this.resetPasswordFunction = createLambda('ResetPasswordFunction', 'auth/reset-password.ts', {
      description: 'Reset password endpoint',
    });

    this.adminDashboardFunction = createLambda('AdminDashboardFunction', 'admin/admin-dashboard.ts', {
      description: 'Admin dashboard statistics and system health',
    });

    this.adminUserManagementFunction = createLambda('AdminUserManagementFunction', 'admin/user-management.ts', {
      description: 'Admin user management endpoints',
    });

    this.adminBadgesFunction = createLambda('AdminBadgesFunction', 'admin/badges.ts', {
      description: 'Admin badge operations and AWS employee flagging',
    });

    this.adminModerationFunction = createLambda('AdminModerationFunction', 'admin/moderate-content.ts', {
      description: 'Admin content moderation endpoints',
      timeout: cdk.Duration.seconds(45),
    });

    this.adminAuditLogFunction = createLambda('AdminAuditLogFunction', 'admin/audit-log.ts', {
      description: 'Admin action audit log retrieval',
    });

    this.analyticsTrackFunction = createLambda('AnalyticsTrackFunction', 'analytics/track-event.ts', {
      description: 'Analytics event tracking endpoint',
    });

    this.analyticsUserFunction = createLambda('AnalyticsUserFunction', 'analytics/user-analytics.ts', {
      description: 'Authenticated user analytics endpoint',
    });

    this.analyticsExportFunction = createLambda('AnalyticsExportFunction', 'analytics/export-analytics.ts', {
      description: 'Analytics CSV export endpoint',
    });

    this.exportCsvFunction = createLambda('ProgramExportFunction', 'export/csv-export.ts', {
      description: 'Program-specific content export',
    });

    this.exportHistoryFunction = createLambda('ExportHistoryFunction', 'export/history.ts', {
      description: 'Export history retrieval endpoint',
    });

    this.userExportFunction = createLambda('UserExportFunction', 'users/export-data.ts', {
      description: 'GDPR data export endpoint for authenticated users',
    });

    this.userDeleteAccountFunction = createLambda('UserDeleteAccountFunction', 'users/delete-account.ts', {
      description: 'GDPR account deletion endpoint for authenticated users',
    });

    this.userUpdateProfileFunction = createLambda('UserUpdateProfileFunction', 'users/update-profile.ts', {
      description: 'User profile update (right to rectification)',
    });

    this.userUpdatePreferencesFunction = createLambda('UserUpdatePreferencesFunction', 'users/update-preferences.ts', {
      description: 'User communication preferences update endpoint',
    });

    this.userManageConsentFunction = createLambda('UserManageConsentFunction', 'user/manage-consent.ts', {
      description: 'User consent management endpoint',
    });

    this.userBadgesFunction = createLambda('UserBadgesFunction', 'users/get-badges.ts', {
      description: 'Public user badges retrieval endpoint',
    });

    this.userGetCurrentFunction = createLambda('UserGetCurrentFunction', 'users/get-current.ts', {
      description: 'Authenticated user profile retrieval endpoint',
    });

    this.userGetByUsernameFunction = createLambda('UserGetByUsernameFunction', 'users/get-by-username.ts', {
      description: 'Public user profile lookup by username',
    });

    this.userContentFunction = createLambda('UserContentFunction', 'users/get-content.ts', {
      description: 'User content listing with visibility filtering',
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

    this.feedbackIngestFunction = createLambda('FeedbackIngestFunction', 'feedback/ingest.ts', {
      description: 'Beta feedback ingestion endpoint',
      environment: {
        FEEDBACK_TABLE_NAME: this.betaFeedbackTable.tableName,
      },
    });

    this.betaFeedbackTable.grantWriteData(this.feedbackIngestFunction);

    this.dataRetentionFunction = createLambda('DataRetentionFunction', 'maintenance/data-retention.ts', {
      description: 'Analytics data retention cleanup',
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        ANALYTICS_RETENTION_DAYS: requireEnv('ANALYTICS_RETENTION_DAYS'),
      },
    });

    this.contentFindDuplicatesFunction = createLambda('ContentFindDuplicatesFunction', 'content/find-duplicates.ts', {
      description: 'Duplicate detection API for contributors',
      timeout: cdk.Duration.minutes(2),
    });

    this.contentDetectDuplicatesFunction = createLambda('ContentDetectDuplicatesFunction', 'content/detect-duplicates.ts', {
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
