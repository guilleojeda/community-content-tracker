import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApplicationApiStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  enableTracing?: boolean;
}

export class ApplicationApiStack extends cdk.Stack {
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

  constructor(scope: Construct, id: string, props: ApplicationApiStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const enableTracing = props.enableTracing ?? true;

    const lambdaRuntime = lambda.Runtime.NODEJS_18_X;
    const lambdaTimeout = cdk.Duration.seconds(30);
    const lambdaMemory = 512;
    const lambdaCodePath = path.join(__dirname, '../../../backend/lambdas');

    const commonEnvironment: Record<string, string> = {
      DATABASE_SECRET_ARN: props.databaseSecretArn,
      ENVIRONMENT: envName,
    };

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

    new cdk.CfnOutput(this, 'AdminDashboardLambdaArn', {
      value: this.adminDashboardFunction.functionArn,
      description: 'Admin dashboard Lambda ARN',
      exportName: `community-content-tracker-admin-dashboard-${envName}`,
    });

    cdk.Tags.of(this).add('Project', 'CommunityContentTracker');
    cdk.Tags.of(this).add('Component', 'ApplicationApi');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('Sprint', '7');
  }
}
