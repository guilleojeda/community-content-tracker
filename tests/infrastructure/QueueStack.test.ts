import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { QueueStack } from '../../src/infrastructure/lib/stacks/QueueStack';

describe('QueueStack', () => {
  let app: cdk.App;
  let stack: QueueStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new QueueStack(app, 'TestQueueStack', {
      environment: 'test',
    });
    template = Template.fromStack(stack);
  });

  describe('Dead Letter Queue', () => {
    it('should create a dead letter queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'content-processing-dlq-test',
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });
  });

  describe('Content Processing Queue', () => {
    it('should create the content processing queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'content-processing-queue-test',
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });

    it('should configure visibility timeout for processing', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'content-processing-queue-test',
        VisibilityTimeout: 900, // 15 minutes
      });
    });

    it('should configure dead letter queue with max receive count', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'content-processing-queue-test',
        RedrivePolicy: {
          maxReceiveCount: 3,
        },
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    it('should create alarm for DLQ messages', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'content-processing-dlq-alarm-test',
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Namespace: 'AWS/SQS',
        Statistic: 'Maximum',
        Threshold: 1,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });

    it('should create alarm for age of oldest message', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'content-processing-old-messages-test',
        MetricName: 'ApproximateAgeOfOldestMessage',
        Namespace: 'AWS/SQS',
        Statistic: 'Maximum',
        Threshold: 3600, // 1 hour
        EvaluationPeriods: 2,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });
  });

  describe('Stack Outputs', () => {
    it('should export queue URL', () => {
      template.hasOutput('ContentProcessingQueueUrl', {});
    });

    it('should export queue ARN', () => {
      template.hasOutput('ContentProcessingQueueArn', {});
    });

    it('should export DLQ URL', () => {
      template.hasOutput('ContentProcessingDLQUrl', {});
    });
  });
});
