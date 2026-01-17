import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { MonitoringStack } from '../../src/infrastructure/lib/stacks/MonitoringStack';
import { DatabaseStack } from '../../src/infrastructure/lib/stacks/database-stack';
import { QueueStack } from '../../src/infrastructure/lib/stacks/QueueStack';

const createTestFunction = (scope: cdk.Stack, id: string): lambda.Function =>
  new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });

describe('MonitoringStack', () => {
  it('creates dashboards, alarms, and synthetic monitoring for the platform', () => {
    const app = new cdk.App();
    const databaseStack = new DatabaseStack(app, 'TestDatabaseStack', {
      environment: 'dev',
      databaseName: 'community_content',
    });
    const queueStack = new QueueStack(app, 'TestQueueStack', { environment: 'dev' });
    const functionStack = new cdk.Stack(app, 'TestFunctionsStack');

    const monitoringStack = new MonitoringStack(app, 'TestMonitoringStack', {
      environment: 'dev',
      searchFunction: createTestFunction(functionStack, 'SearchFn'),
      statsFunction: createTestFunction(functionStack, 'StatsFn'),
      analyticsTrackFunction: createTestFunction(functionStack, 'AnalyticsTrackFn'),
      analyticsUserFunction: createTestFunction(functionStack, 'AnalyticsUserFn'),
      analyticsExportFunction: createTestFunction(functionStack, 'AnalyticsExportFn'),
      dataRetentionFunction: createTestFunction(functionStack, 'DataRetentionFn'),
      userExportFunction: createTestFunction(functionStack, 'UserExportFn'),
      userDeleteAccountFunction: createTestFunction(functionStack, 'UserDeleteFn'),
      userManageConsentFunction: createTestFunction(functionStack, 'UserConsentFn'),
      feedbackIngestFunction: createTestFunction(functionStack, 'FeedbackFn'),
      databaseCluster: databaseStack.cluster,
      databaseProxy: databaseStack.proxy,
      contentQueue: queueStack.contentProcessingQueue,
      contentDeadLetterQueue: queueStack.contentProcessingDLQ,
      syntheticCheckUrl: 'https://example.org/health',
    });

    const template = Template.fromStack(monitoringStack);

    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'community-content-hub-dev-operations',
    });

    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'Community Content Hub dev Alerts',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Search error rate exceeded 1%',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Search latency p99 above 1000ms',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'User Analytics latency p99 above 1000ms',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Feedback Ingest latency p99 above 1000ms',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Database connections above 70',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Messages detected in content processing DLQ (>= 1)',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Estimated daily AWS spend exceeded $500',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Synthetic monitoring detected availability below 99%',
      ComparisonOperator: 'LessThanThreshold',
      Threshold: 99,
    });

    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Handler: 'index.handler',
      Description: 'Synthetic monitor for critical user journey',
    }));

    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(5 minutes)',
    });

    template.hasOutput('OperationsDashboardName', Match.objectLike({
      Description: 'CloudWatch Operations dashboard name',
    }));

    template.hasOutput('AlertTopicArn', Match.objectLike({
      Description: 'SNS topic ARN for operational alerts',
    }));
  });

  it('honors environment overrides for monitoring thresholds', () => {
    const originalEnv = {
      MONITORING_ERROR_RATE_THRESHOLD: process.env.MONITORING_ERROR_RATE_THRESHOLD,
      MONITORING_P99_LATENCY_MS: process.env.MONITORING_P99_LATENCY_MS,
      MONITORING_DB_CONNECTION_THRESHOLD: process.env.MONITORING_DB_CONNECTION_THRESHOLD,
      MONITORING_DLQ_THRESHOLD: process.env.MONITORING_DLQ_THRESHOLD,
      MONITORING_DAILY_COST_THRESHOLD: process.env.MONITORING_DAILY_COST_THRESHOLD,
      MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD: process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD,
      MONITORING_BILLING_REGION: process.env.MONITORING_BILLING_REGION,
    };
    process.env.MONITORING_ERROR_RATE_THRESHOLD = '0.02';
    process.env.MONITORING_P99_LATENCY_MS = '1500';
    process.env.MONITORING_DB_CONNECTION_THRESHOLD = '80';
    process.env.MONITORING_DLQ_THRESHOLD = '2';
    process.env.MONITORING_DAILY_COST_THRESHOLD = '750';
    process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD = '95';
    process.env.MONITORING_BILLING_REGION = 'eu-west-1';

    try {
      const app = new cdk.App();
      const databaseStack = new DatabaseStack(app, 'OverrideDatabaseStack', {
        environment: 'dev',
        databaseName: 'community_content',
      });
      const queueStack = new QueueStack(app, 'OverrideQueueStack', { environment: 'dev' });
      const functionStack = new cdk.Stack(app, 'OverrideFunctionsStack');

      const monitoringStack = new MonitoringStack(app, 'OverrideMonitoringStack', {
        environment: 'dev',
        searchFunction: createTestFunction(functionStack, 'SearchFnOverride'),
        statsFunction: createTestFunction(functionStack, 'StatsFnOverride'),
        analyticsTrackFunction: createTestFunction(functionStack, 'AnalyticsTrackFnOverride'),
        analyticsUserFunction: createTestFunction(functionStack, 'AnalyticsUserFnOverride'),
        analyticsExportFunction: createTestFunction(functionStack, 'AnalyticsExportFnOverride'),
        dataRetentionFunction: createTestFunction(functionStack, 'DataRetentionFnOverride'),
        userExportFunction: createTestFunction(functionStack, 'UserExportFnOverride'),
        userDeleteAccountFunction: createTestFunction(functionStack, 'UserDeleteFnOverride'),
        userManageConsentFunction: createTestFunction(functionStack, 'UserConsentFnOverride'),
        feedbackIngestFunction: createTestFunction(functionStack, 'FeedbackFnOverride'),
        databaseCluster: databaseStack.cluster,
        databaseProxy: databaseStack.proxy,
        contentQueue: queueStack.contentProcessingQueue,
        contentDeadLetterQueue: queueStack.contentProcessingDLQ,
        syntheticCheckUrl: 'https://example.org/health',
      });

      const template = Template.fromStack(monitoringStack);

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Search error rate exceeded 2%',
      });

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Search latency p99 above 1500ms',
      });

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Database connections above 80',
      });

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Messages detected in content processing DLQ (>= 2)',
      });

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Estimated daily AWS spend exceeded $750',
        Threshold: 750,
      });

      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Synthetic monitoring detected availability below 95%',
        Threshold: 95,
      });
    } finally {
      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    }
  });
});
