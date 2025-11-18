import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface QueueStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * QueueStack creates SQS queues for content processing.
 *
 * Message Format:
 * The queue expects ContentProcessorMessage with the following structure:
 * {
 *   userId: string;
 *   channelId: string;
 *   title: string;
 *   description?: string;
 *   contentType: 'blog' | 'youtube' | 'github';
 *   url: string;
 *   publishDate?: string;
 *   metadata?: Record<string, any>;
 * }
 *
 * Required Message Attributes:
 * - contentType: The type of content being processed ('blog', 'youtube', 'github')
 * - channelId: The ID of the channel this content belongs to
 *
 * Processing Flow:
 * 1. Scrapers send messages to contentProcessingQueue
 * 2. Content processor Lambda consumes messages
 * 3. Failed messages (after 3 retries) move to contentProcessingDLQ
 * 4. CloudWatch alarms trigger on DLQ messages or stuck messages
 */
export class QueueStack extends cdk.Stack {
  public readonly contentProcessingQueue: sqs.Queue;
  public readonly contentProcessingDLQ: sqs.Queue;

  constructor(scope: Construct, id: string, props: QueueStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Create Dead Letter Queue
    this.contentProcessingDLQ = new sqs.Queue(this, 'ContentProcessingDLQ', {
      queueName: `content-processing-dlq-${environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Create Content Processing Queue with DLQ
    this.contentProcessingQueue = new sqs.Queue(this, 'ContentProcessingQueue', {
      queueName: `content-processing-queue-${environment}`,
      visibilityTimeout: cdk.Duration.minutes(15), // Appropriate for processing time
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: this.contentProcessingDLQ,
        maxReceiveCount: 3, // Retry up to 3 times before moving to DLQ
      },
    });

    // CloudWatch Alarm for DLQ messages
    new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `content-processing-dlq-alarm-${environment}`,
      alarmDescription: 'Alarm when messages appear in DLQ',
      metric: this.contentProcessingDLQ.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // CloudWatch Alarm for old messages in main queue
    new cloudwatch.Alarm(this, 'OldMessagesAlarm', {
      alarmName: `content-processing-old-messages-${environment}`,
      alarmDescription: 'Alarm when messages are stuck in queue for too long',
      metric: this.contentProcessingQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 3600, // 1 hour in seconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'ContentProcessingQueueUrl', {
      value: this.contentProcessingQueue.queueUrl,
      description: 'URL of the content processing queue',
      exportName: `ContentProcessingQueueUrl-${environment}`,
    });

    new cdk.CfnOutput(this, 'ContentProcessingQueueArn', {
      value: this.contentProcessingQueue.queueArn,
      description: 'ARN of the content processing queue',
      exportName: `ContentProcessingQueueArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'ContentProcessingDLQUrl', {
      value: this.contentProcessingDLQ.queueUrl,
      description: 'URL of the content processing dead letter queue',
      exportName: `ContentProcessingDLQUrl-${environment}`,
    });

    // Add tags
    cdk.Tags.of(this).add('Component', 'ContentIngestion');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
