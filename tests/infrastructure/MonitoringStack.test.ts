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
    const databaseStack = new DatabaseStack(app, 'TestDatabaseStack', { environment: 'dev' });
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
      AlarmDescription: 'Search latency p99 above 1s',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'User Analytics latency p99 above 1s',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Feedback Ingest latency p99 above 1s',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Database connections above 70',
    });

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: 'Messages detected in content processing DLQ',
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
      Handler: 'synthetic-check.handler',
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
});
