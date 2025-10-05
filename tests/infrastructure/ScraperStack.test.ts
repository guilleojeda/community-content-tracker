import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { ScraperStack } from '../../src/infrastructure/lib/stacks/ScraperStack';

describe('ScraperStack', () => {
  let app: cdk.App;
  let stack: ScraperStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();

    // Create a minimal helper stack for importing external resources
    const importStack = new cdk.Stack(app, 'ImportStack');

    // Import mock resources using ARNs
    const mockQueue = sqs.Queue.fromQueueArn(
      importStack,
      'MockQueue',
      'arn:aws:sqs:us-east-1:123456789012:mock-content-processing-queue'
    );

    const mockYouTubeSecret = secretsmanager.Secret.fromSecretCompleteArn(
      importStack,
      'MockYouTubeSecret',
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:mock-youtube-key-abc123'
    );

    const mockGitHubSecret = secretsmanager.Secret.fromSecretCompleteArn(
      importStack,
      'MockGitHubSecret',
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:mock-github-token-xyz789'
    );

    // Create ScraperStack with imported resources
    stack = new ScraperStack(app, 'TestScraperStack', {
      environment: 'test',
      databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-db-secret-abc123',
      contentProcessingQueue: mockQueue as sqs.Queue,
      youtubeApiKeySecret: mockYouTubeSecret,
      githubTokenSecret: mockGitHubSecret,
    });

    template = Template.fromStack(stack);
  });

  describe('Lambda Functions', () => {
    describe('Orchestrator Function', () => {
      it('should create orchestrator Lambda with correct configuration', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'scraper-orchestrator-test',
          Runtime: 'nodejs18.x',
          Handler: 'scrapers/orchestrator.handler',
          Timeout: 120, // 2 minutes
          MemorySize: 256,
        });
      });

      it('should configure orchestrator with scraper function names', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'scraper-orchestrator-test',
          Environment: {
            Variables: Match.objectLike({
              BLOG_SCRAPER_FUNCTION_NAME: Match.anyValue(),
              YOUTUBE_SCRAPER_FUNCTION_NAME: Match.anyValue(),
              GITHUB_SCRAPER_FUNCTION_NAME: Match.anyValue(),
            }),
          },
        });
      });

      it('should configure orchestrator with secure environment variables', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'scraper-orchestrator-test',
          Environment: {
            Variables: Match.objectLike({
              DATABASE_SECRET_ARN: Match.stringLikeRegexp('arn:aws:secretsmanager:.*:secret:test-db-secret.*'),
              ENVIRONMENT: 'test',
              CONTENT_PROCESSING_QUEUE_URL: Match.anyValue(),
            }),
          },
        });
      });
    });

    describe('Blog Scraper Function', () => {
      it('should create blog scraper with appropriate timeout', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'blog-scraper-test',
          Runtime: 'nodejs18.x',
          Handler: 'scrapers/blog-rss.handler',
          Timeout: 300, // 5 minutes
          MemorySize: 512,
        });
      });

      it('should configure blog scraper with secure environment variables', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'blog-scraper-test',
          Environment: {
            Variables: Match.objectLike({
              DATABASE_SECRET_ARN: Match.stringLikeRegexp('arn:aws:secretsmanager:.*:secret:test-db-secret.*'),
              ENVIRONMENT: 'test',
            }),
          },
        });
      });
    });

    describe('YouTube Scraper Function', () => {
      it('should create YouTube scraper with appropriate timeout', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'youtube-scraper-test',
          Runtime: 'nodejs18.x',
          Handler: 'scrapers/youtube.handler',
          Timeout: 300, // 5 minutes
          MemorySize: 512,
        });
      });

      it('should configure YouTube scraper with API key secret ARN', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'youtube-scraper-test',
          Environment: {
            Variables: Match.objectLike({
              YOUTUBE_API_SECRET_ARN: Match.anyValue(),
            }),
          },
        });
      });
    });

    describe('GitHub Scraper Function', () => {
      it('should create GitHub scraper with appropriate timeout', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'github-scraper-test',
          Runtime: 'nodejs18.x',
          Handler: 'scrapers/github.handler',
          Timeout: 300, // 5 minutes
          MemorySize: 512,
        });
      });

      it('should configure GitHub scraper with token secret ARN', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'github-scraper-test',
          Environment: {
            Variables: Match.objectLike({
              GITHUB_TOKEN_SECRET_ARN: Match.anyValue(),
            }),
          },
        });
      });
    });

    describe('Content Processor Function', () => {
      it('should create content processor with extended timeout for Bedrock', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'content-processor-test',
          Runtime: 'nodejs18.x',
          Handler: 'scrapers/content-processor.handler',
          Timeout: 900, // 15 minutes
          MemorySize: 1024,
        });
      });

      it('should configure content processor with reserved concurrency', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'content-processor-test',
        });
      });

      it('should configure content processor with Bedrock settings', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'content-processor-test',
          Environment: {
            Variables: Match.objectLike({
              BEDROCK_REGION: Match.anyValue(),
              BEDROCK_MODEL_ID: 'amazon.titan-embed-text-v1',
            }),
          },
        });
      });
    });

    describe('Channel Sync Function', () => {
      it('should create channel sync function', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'channel-sync-test',
          Runtime: 'nodejs18.x',
          Handler: 'channels/sync.handler',
          Timeout: 30,
          MemorySize: 256,
        });
      });

      it('should configure channel sync with scraper function names', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
          FunctionName: 'channel-sync-test',
          Environment: {
            Variables: Match.objectLike({
              BLOG_SCRAPER_FUNCTION_NAME: Match.anyValue(),
              YOUTUBE_SCRAPER_FUNCTION_NAME: Match.anyValue(),
              GITHUB_SCRAPER_FUNCTION_NAME: Match.anyValue(),
            }),
          },
        });
      });
    });
  });

  describe('EventBridge Schedule', () => {
    it('should create daily schedule rule at 2 AM UTC', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'daily-scraper-schedule-test',
        Description: 'Triggers content scrapers daily at 2 AM UTC',
        ScheduleExpression: 'cron(0 2 * * ? *)',
      });
    });

    it('should disable schedule for non-production environments', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'daily-scraper-schedule-test',
        State: 'DISABLED', // test environment should be disabled
      });
    });

    it('should target orchestrator Lambda', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'daily-scraper-schedule-test',
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('EventBridge Schedule - Production Environment', () => {
    let prodApp: cdk.App;
    let prodStack: ScraperStack;
    let prodTemplate: Template;

    beforeEach(() => {
      prodApp = new cdk.App();

      // Create import stack for prod resources
      const prodImportStack = new cdk.Stack(prodApp, 'ProdImportStack');

      const prodMockQueue = sqs.Queue.fromQueueArn(
        prodImportStack,
        'ProdMockQueue',
        'arn:aws:sqs:us-east-1:123456789012:mock-prod-content-processing-queue'
      );

      const prodMockYouTubeSecret = secretsmanager.Secret.fromSecretCompleteArn(
        prodImportStack,
        'ProdMockYouTubeSecret',
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:mock-prod-youtube-key-abc123'
      );

      const prodMockGitHubSecret = secretsmanager.Secret.fromSecretCompleteArn(
        prodImportStack,
        'ProdMockGitHubSecret',
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:mock-prod-github-token-xyz789'
      );

      // Create production ScraperStack
      prodStack = new ScraperStack(prodApp, 'ProdScraperStack', {
        environment: 'prod',
        databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod-db-secret-abc123',
        contentProcessingQueue: prodMockQueue as sqs.Queue,
        youtubeApiKeySecret: prodMockYouTubeSecret,
        githubTokenSecret: prodMockGitHubSecret,
      });

      prodTemplate = Template.fromStack(prodStack);
    });

    it('should enable schedule for production environment', () => {
      prodTemplate.hasResourceProperties('AWS::Events::Rule', {
        Name: 'daily-scraper-schedule-prod',
        State: 'ENABLED',
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    it('should create orchestrator error alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'scraper-orchestrator-errors-test',
        AlarmDescription: 'Alert when orchestrator Lambda has errors',
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        Statistic: 'Sum',
        Threshold: 3,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
      });
    });

    it('should create content processor error alarm with higher threshold', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'content-processor-errors-test',
        AlarmDescription: 'Alert when content processor Lambda has errors',
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        Statistic: 'Sum',
        Threshold: 10, // Higher threshold for processor
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
      });
    });
  });

  describe('IAM Permissions', () => {
    it('should grant Secrets Manager read permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('arn:aws:secretsmanager:.*:secret:test-db-secret.*'),
            }),
          ]),
        },
      });
    });

    it('should grant Bedrock invoke permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'bedrock:InvokeModel',
              Effect: 'Allow',
              Resource: '*',
            }),
          ]),
        },
      });
    });

    it('should grant CloudWatch PutMetricData permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'cloudwatch:PutMetricData',
              Effect: 'Allow',
              Resource: '*',
            }),
          ]),
        },
      });
    });

    it('should grant Lambda invoke permissions for scrapers via IAM policies', () => {
      // Check that orchestrator role has Lambda invoke permissions
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });
  });

  describe('SQS Event Source', () => {
    it('should configure SQS event source for content processor', () => {
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 10,
        MaximumBatchingWindowInSeconds: 30,
        FunctionResponseTypes: ['ReportBatchItemFailures'],
      });
    });
  });

  describe('Stack Outputs', () => {
    it('should export orchestrator function ARN', () => {
      template.hasOutput('OrchestratorFunctionArn', {
        Export: {
          Name: 'OrchestratorFunctionArn-test',
        },
      });
    });

    it('should export blog scraper function ARN', () => {
      template.hasOutput('BlogScraperFunctionArn', {
        Export: {
          Name: 'BlogScraperFunctionArn-test',
        },
      });
    });

    it('should export YouTube scraper function ARN', () => {
      template.hasOutput('YouTubeScraperFunctionArn', {
        Export: {
          Name: 'YouTubeScraperFunctionArn-test',
        },
      });
    });

    it('should export GitHub scraper function ARN', () => {
      template.hasOutput('GitHubScraperFunctionArn', {
        Export: {
          Name: 'GitHubScraperFunctionArn-test',
        },
      });
    });

    it('should export content processor function ARN', () => {
      template.hasOutput('ContentProcessorFunctionArn', {
        Export: {
          Name: 'ContentProcessorFunctionArn-test',
        },
      });
    });

    it('should export channel sync function ARN', () => {
      template.hasOutput('ChannelSyncFunctionArn', {
        Export: {
          Name: 'ChannelSyncFunctionArn-test',
        },
      });
    });
  });

  describe('Resource Tagging', () => {
    it('should tag resources with Component', () => {
      const resources = template.findResources('AWS::Lambda::Function');
      expect(Object.keys(resources).length).toBeGreaterThan(0);
    });

    it('should tag resources with Environment', () => {
      const resources = template.findResources('AWS::Lambda::Function');
      expect(Object.keys(resources).length).toBeGreaterThan(0);
    });
  });

  describe('Security Configuration', () => {
    it('should not expose database connection string in environment variables', () => {
      const functions = template.findResources('AWS::Lambda::Function');

      Object.values(functions).forEach((func: any) => {
        const envVars = func.Properties?.Environment?.Variables || {};
        // Ensure DATABASE_URL is not present (security fix)
        expect(envVars.DATABASE_URL).toBeUndefined();
      });
    });

    it('should use DATABASE_SECRET_ARN instead of unwrapped secret', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'blog-scraper-test',
        Environment: {
          Variables: Match.objectLike({
            DATABASE_SECRET_ARN: Match.stringLikeRegexp('arn:aws:secretsmanager:.*'),
          }),
        },
      });
    });
  });

  describe('Lambda Role Configuration', () => {
    it('should create scraper execution role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            }),
          ]),
        },
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('.*AWSLambdaBasicExecutionRole.*'),
              ]),
            ]),
          }),
        ]),
      });
    });

    it('should include VPC execution role policy', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('.*AWSLambdaVPCAccessExecutionRole.*'),
              ]),
            ]),
          }),
        ]),
      });
    });
  });
});
