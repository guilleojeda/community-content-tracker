import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ScraperStackProps extends cdk.StackProps {
  environment: string;
  databaseSecretArn: string;
  contentProcessingQueue: sqs.Queue;
  youtubeApiKeySecret: secretsmanager.ISecret;
  githubTokenSecret: secretsmanager.ISecret;
}

export class ScraperStack extends cdk.Stack {
  public readonly orchestratorFunction: lambda.Function;
  public readonly blogScraperFunction: lambda.Function;
  public readonly youtubeScraperFunction: lambda.Function;
  public readonly githubScraperFunction: lambda.Function;
  public readonly contentProcessorFunction: lambda.Function;
  public readonly channelSyncFunction: lambda.Function;
  public readonly channelCreateFunction: lambda.Function;
  public readonly channelListFunction: lambda.Function;
  public readonly channelUpdateFunction: lambda.Function;
  public readonly channelDeleteFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ScraperStackProps) {
    super(scope, id, props);

    const { environment, databaseSecretArn, contentProcessingQueue, youtubeApiKeySecret, githubTokenSecret } = props;

    // Common Lambda environment variables
    // Pass secret ARN instead of unwrapped value for security
    // Note: AWS_REGION is automatically set by Lambda runtime
    const commonEnvironment: Record<string, string> = {
      DATABASE_SECRET_ARN: databaseSecretArn,
      ENVIRONMENT: environment,
      CONTENT_PROCESSING_QUEUE_URL: contentProcessingQueue.queueUrl,
    };

    // Create separate IAM roles to avoid cyclic dependencies
    // Role for scraper Lambdas (blog, youtube, github)
    const scraperRole = new iam.Role(this, 'ScraperRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    scraperRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [databaseSecretArn, youtubeApiKeySecret.secretArn, githubTokenSecret.secretArn],
    }));

    scraperRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage'],
      resources: [contentProcessingQueue.queueArn],
    }));

    scraperRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Role for content processor Lambda
    const contentProcessorRole = new iam.Role(this, 'ContentProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    contentProcessorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [databaseSecretArn],
    }));

    contentProcessorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
      resources: [contentProcessingQueue.queueArn],
    }));

    contentProcessorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    contentProcessorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Role for orchestrator Lambda
    const orchestratorRole = new iam.Role(this, 'OrchestratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    orchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [databaseSecretArn],
    }));

    orchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Role for channel management Lambdas
    const channelManagementRole = new iam.Role(this, 'ChannelManagementRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    channelManagementRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [databaseSecretArn],
    }));

    channelManagementRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Get Lambda code path (from compiled lib/stacks directory to src/backend/lambdas)
    const lambdaCodePath = path.join(__dirname, '../../../../src/backend/lambdas');

    // Blog RSS Scraper Lambda
    this.blogScraperFunction = new lambda.Function(this, 'BlogScraperFunction', {
      functionName: `blog-scraper-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scrapers/blog-rss.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnvironment,
      role: scraperRole,
    });

    // YouTube Scraper Lambda
    this.youtubeScraperFunction = new lambda.Function(this, 'YouTubeScraperFunction', {
      functionName: `youtube-scraper-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scrapers/youtube.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...commonEnvironment,
        YOUTUBE_API_SECRET_ARN: youtubeApiKeySecret.secretArn,
      },
      role: scraperRole,
    });

    // GitHub Scraper Lambda
    this.githubScraperFunction = new lambda.Function(this, 'GitHubScraperFunction', {
      functionName: `github-scraper-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scrapers/github.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...commonEnvironment,
        GITHUB_TOKEN_SECRET_ARN: githubTokenSecret.secretArn,
      },
      role: scraperRole,
    });

    // Content Processor Lambda (SQS consumer)
    this.contentProcessorFunction = new lambda.Function(this, 'ContentProcessorFunction', {
      functionName: `content-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scrapers/content-processor.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...commonEnvironment,
        BEDROCK_REGION: this.region,
        BEDROCK_MODEL_ID: 'amazon.titan-embed-text-v1',
      },
      role: contentProcessorRole,
    });

    // Add SQS event source to content processor
    this.contentProcessorFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(contentProcessingQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(30),
        reportBatchItemFailures: true,
      })
    );

    // Orchestrator Lambda (triggers all scrapers)
    this.orchestratorFunction = new lambda.Function(this, 'OrchestratorFunction', {
      functionName: `scraper-orchestrator-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scrapers/orchestrator.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        ...commonEnvironment,
        BLOG_SCRAPER_FUNCTION_NAME: this.blogScraperFunction.functionName,
        YOUTUBE_SCRAPER_FUNCTION_NAME: this.youtubeScraperFunction.functionName,
        GITHUB_SCRAPER_FUNCTION_NAME: this.githubScraperFunction.functionName,
      },
      role: orchestratorRole,
    });

    // Add permission to invoke scraper Lambdas directly to orchestrator role
    orchestratorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        this.blogScraperFunction.functionArn,
        this.youtubeScraperFunction.functionArn,
        this.githubScraperFunction.functionArn,
      ],
    }));

    // Channel Sync Lambda (for manual sync endpoint)
    this.channelSyncFunction = new lambda.Function(this, 'ChannelSyncFunction', {
      functionName: `channel-sync-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'channels/sync.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ...commonEnvironment,
        BLOG_SCRAPER_FUNCTION_NAME: this.blogScraperFunction.functionName,
        YOUTUBE_SCRAPER_FUNCTION_NAME: this.youtubeScraperFunction.functionName,
        GITHUB_SCRAPER_FUNCTION_NAME: this.githubScraperFunction.functionName,
      },
      role: channelManagementRole,
    });

    // Add permission to invoke scraper Lambdas directly to channel sync role
    channelManagementRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        this.blogScraperFunction.functionArn,
        this.youtubeScraperFunction.functionArn,
        this.githubScraperFunction.functionArn,
      ],
    }));

    // Channel Management API Lambda Functions
    // POST /channels - Create new channel
    this.channelCreateFunction = new lambda.Function(this, 'ChannelCreateFunction', {
      functionName: `channel-create-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'channels/create.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnvironment,
      role: channelManagementRole,
    });

    // GET /channels - List user's channels
    this.channelListFunction = new lambda.Function(this, 'ChannelListFunction', {
      functionName: `channel-list-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'channels/list.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnvironment,
      role: channelManagementRole,
    });

    // PUT /channels/:id - Update channel
    this.channelUpdateFunction = new lambda.Function(this, 'ChannelUpdateFunction', {
      functionName: `channel-update-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'channels/update.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnvironment,
      role: channelManagementRole,
    });

    // DELETE /channels/:id - Delete channel
    this.channelDeleteFunction = new lambda.Function(this, 'ChannelDeleteFunction', {
      functionName: `channel-delete-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'channels/delete.handler',
      code: lambda.Code.fromAsset(lambdaCodePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnvironment,
      role: channelManagementRole,
    });

    // EventBridge Rule for daily scheduling (runs at 2 AM UTC)
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const dailyScheduleRule = new events.Rule(this, 'DailyScraperSchedule', {
      ruleName: `daily-scraper-schedule-${environment}`,
      description: 'Triggers content scrapers daily at 2 AM UTC',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: productionLikeEnvs.has(environment) || environment === 'staging',
    });

    // Add orchestrator as target for the rule
    dailyScheduleRule.addTarget(new targets.LambdaFunction(this.orchestratorFunction));

    // CloudWatch metric alarms for scraper failures
    const orchestratorErrorMetric = this.orchestratorFunction.metricErrors({
      period: cdk.Duration.hours(1),
      statistic: 'Sum',
    });

    const orchestratorErrorAlarm = orchestratorErrorMetric.createAlarm(this, 'OrchestratorErrorAlarm', {
      alarmName: `scraper-orchestrator-errors-${environment}`,
      alarmDescription: 'Alert when orchestrator Lambda has errors',
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const processorErrorMetric = this.contentProcessorFunction.metricErrors({
      period: cdk.Duration.hours(1),
      statistic: 'Sum',
    });

    const processorErrorAlarm = processorErrorMetric.createAlarm(this, 'ProcessorErrorAlarm', {
      alarmName: `content-processor-errors-${environment}`,
      alarmDescription: 'Alert when content processor Lambda has errors',
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Stack Outputs
    new cdk.CfnOutput(this, 'OrchestratorFunctionArn', {
      value: this.orchestratorFunction.functionArn,
      description: 'ARN of the scraper orchestrator Lambda function',
      exportName: `OrchestratorFunctionArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'BlogScraperFunctionArn', {
      value: this.blogScraperFunction.functionArn,
      description: 'ARN of the blog scraper Lambda function',
      exportName: `BlogScraperFunctionArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'YouTubeScraperFunctionArn', {
      value: this.youtubeScraperFunction.functionArn,
      description: 'ARN of the YouTube scraper Lambda function',
      exportName: `YouTubeScraperFunctionArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'GitHubScraperFunctionArn', {
      value: this.githubScraperFunction.functionArn,
      description: 'ARN of the GitHub scraper Lambda function',
      exportName: `GitHubScraperFunctionArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'ContentProcessorFunctionArn', {
      value: this.contentProcessorFunction.functionArn,
      description: 'ARN of the content processor Lambda function',
      exportName: `ContentProcessorFunctionArn-${environment}`,
    });

    new cdk.CfnOutput(this, 'ChannelSyncFunctionArn', {
      value: this.channelSyncFunction.functionArn,
      description: 'ARN of the channel sync Lambda function',
      exportName: `ChannelSyncFunctionArn-${environment}`,
    });

    // Add tags
    cdk.Tags.of(this).add('Component', 'ContentIngestion');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
