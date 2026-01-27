import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Template } from 'aws-cdk-lib/assertions';
import { MonitoringStack } from '../lib/stacks/MonitoringStack';
import { PublicApiStack } from '../lib/stacks/PublicApiStack';
import { ScraperStack } from '../lib/stacks/ScraperStack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { StaticSiteStack } from '../lib/stacks/static-site-stack';
import { ApplicationApiStack } from '../lib/stacks/ApplicationApiStack';
import { CognitoStack } from '../lib/stacks/CognitoStack';
import { getEnvironmentConfig } from '../lib/config/environments';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambda = jest.requireActual('aws-cdk-lib/aws-lambda');
  class MockNodejsFunction extends lambda.Function {
    constructor(scope: any, id: string, props: any) {
      const { entry: _entry, depsLockFilePath: _depsLockFilePath, bundling: _bundling, ...functionProps } = props;
      super(scope, id, {
        ...functionProps,
        code: lambda.Code.fromInline('exports.handler = async () => {};'),
      });
    }
  }
  return { NodejsFunction: MockNodejsFunction };
});

const originalEnv = { ...process.env };

const resetEnv = () => {
  process.env = { ...originalEnv };
};

const createVpc = (scope: cdk.Stack) =>
  new ec2.Vpc(scope, 'Vpc', {
    maxAzs: 2,
    subnetConfiguration: [
      { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
      { name: 'PrivateEgress', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      { name: 'PrivateIsolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    ],
  });

describe('Infrastructure stack branch coverage', () => {
  afterEach(() => {
    resetEnv();
  });

  describe('MonitoringStack environment validation', () => {
    const baseMonitoringProps = {
      environment: 'test',
      searchFunction: {} as any,
      statsFunction: {} as any,
      analyticsTrackFunction: {} as any,
      analyticsUserFunction: {} as any,
      analyticsExportFunction: {} as any,
      dataRetentionFunction: {} as any,
      userExportFunction: {} as any,
      userDeleteAccountFunction: {} as any,
      userManageConsentFunction: {} as any,
      feedbackIngestFunction: {} as any,
      databaseCluster: {} as any,
      databaseProxy: {} as any,
      contentQueue: {} as any,
      contentDeadLetterQueue: {} as any,
    };

    it('throws when synthetic URL is missing', () => {
      const app = new cdk.App();
      delete process.env.SYNTHETIC_URL;
      expect(() => new MonitoringStack(app, 'MonitoringMissingUrl', baseMonitoringProps)).toThrow(
        'SYNTHETIC_URL must be provided via props or environment variable'
      );
    });

    it('throws when numeric monitoring thresholds are missing', () => {
      const app = new cdk.App();
      process.env.SYNTHETIC_URL = 'https://example.com';
      delete process.env.MONITORING_ERROR_RATE_THRESHOLD;
      expect(() => new MonitoringStack(app, 'MonitoringMissingThreshold', baseMonitoringProps)).toThrow(
        'MONITORING_ERROR_RATE_THRESHOLD must be set'
      );
    });

    it('throws when monitoring thresholds are invalid', () => {
      const app = new cdk.App();
      process.env.SYNTHETIC_URL = 'https://example.com';
      process.env.MONITORING_ERROR_RATE_THRESHOLD = '0.01';
      process.env.MONITORING_P99_LATENCY_MS = 'invalid';
      process.env.MONITORING_DB_CONNECTION_THRESHOLD = '70';
      process.env.MONITORING_DLQ_THRESHOLD = '1';
      process.env.MONITORING_DAILY_COST_THRESHOLD = '500';
      process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD = '99';
      expect(() => new MonitoringStack(app, 'MonitoringInvalidThreshold', baseMonitoringProps)).toThrow(
        'MONITORING_P99_LATENCY_MS must be a valid number'
      );
    });

    it('throws when billing region is missing', () => {
      const app = new cdk.App();
      process.env.SYNTHETIC_URL = 'https://example.com';
      process.env.MONITORING_ERROR_RATE_THRESHOLD = '0.01';
      process.env.MONITORING_P99_LATENCY_MS = '1000';
      process.env.MONITORING_DB_CONNECTION_THRESHOLD = '70';
      process.env.MONITORING_DLQ_THRESHOLD = '1';
      process.env.MONITORING_DAILY_COST_THRESHOLD = '500';
      process.env.MONITORING_SYNTHETIC_AVAILABILITY_THRESHOLD = '99';
      delete process.env.MONITORING_BILLING_REGION;
      delete process.env.BILLING_REGION;
      delete process.env.AWS_BILLING_REGION;
      expect(() => new MonitoringStack(app, 'MonitoringMissingBilling', baseMonitoringProps)).toThrow(
        'MONITORING_BILLING_REGION must be set for billing alarms'
      );
    });
  });

  describe('ScraperStack environment validation', () => {
    it('throws when database pool settings are missing', () => {
      const app = new cdk.App();
      delete process.env.DATABASE_POOL_MIN;
      const queue = {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/queue',
        queueArn: 'arn:aws:sqs:us-east-1:123:queue',
      } as any;
      const secret = { secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:test' } as any;
      expect(() =>
        new ScraperStack(app, 'ScraperMissingPool', {
          environment: 'dev',
          databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:db',
          databaseProxyEndpoint: 'db.local',
          databaseName: 'community_content',
          redisUrl: 'redis://cache.local:6379',
          contentProcessingQueue: queue,
          youtubeApiKeySecret: secret,
          githubTokenSecret: secret,
          vpc: {} as any,
          lambdaSecurityGroup: {} as any,
        })
      ).toThrow('DATABASE_POOL_MIN must be set');
    });
  });

  describe('PublicApiStack environment handling', () => {
    it('throws when required env values are missing', () => {
      const app = new cdk.App();
      delete process.env.CORS_ORIGIN;
      expect(() =>
        new PublicApiStack(app, 'PublicApiMissingEnv', {
          environment: 'dev',
          databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:db',
          databaseProxyEndpoint: 'db.local',
          databaseName: 'community_content',
          redisUrl: 'redis://cache.local:6379',
          vpc: {} as any,
          lambdaSecurityGroup: {} as any,
        })
      ).toThrow('CORS_ORIGIN must be set');
    });

    it('includes CORS credentials when configured', () => {
      const app = new cdk.App();
      process.env.CORS_CREDENTIALS = 'true';
      const networkStack = new cdk.Stack(app, 'PublicApiNetwork');
      const vpc = createVpc(networkStack);
      const lambdaSecurityGroup = new ec2.SecurityGroup(networkStack, 'PublicApiLambdaSg', { vpc });

      const stack = new PublicApiStack(app, 'PublicApiConfigured', {
        environment: 'dev',
        databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:db',
        databaseProxyEndpoint: 'db.local',
        databaseName: 'community_content',
        redisUrl: 'redis://cache.local:6379',
        vpc,
        lambdaSecurityGroup,
      });

      const template = Template.fromStack(stack);
      const functions = template.findResources('AWS::Lambda::Function');
      const hasCorsCredentials = Object.values(functions).some((resource: any) => {
        const variables = resource.Properties?.Environment?.Variables ?? {};
        return variables.CORS_CREDENTIALS === 'true';
      });
      expect(hasCorsCredentials).toBe(true);
    });
  });

  describe('ApplicationApiStack environment handling', () => {
    it('throws when required env values are missing', () => {
      const app = new cdk.App();
      delete process.env.CORS_ORIGIN;
      const config = getEnvironmentConfig('dev');
      expect(() =>
        new ApplicationApiStack(app, 'ApplicationApiMissingEnv', {
          environment: 'dev',
          databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:db',
          databaseProxyEndpoint: 'db.local',
          databaseName: 'community_content',
          redisUrl: 'redis://cache.local:6379',
          config,
          userPool: {} as any,
          userPoolClient: {} as any,
          vpc: {} as any,
          lambdaSecurityGroup: {} as any,
        })
      ).toThrow('CORS_ORIGIN must be set');
    });

    it('includes CORS credentials when configured', () => {
      const app = new cdk.App();
      process.env.CORS_CREDENTIALS = 'true';
      const config = getEnvironmentConfig('dev');

      const networkStack = new cdk.Stack(app, 'ApplicationApiNetwork');
      const vpc = createVpc(networkStack);
      const lambdaSecurityGroup = new ec2.SecurityGroup(networkStack, 'ApplicationApiLambdaSg', { vpc });

      const authStack = new cdk.Stack(app, 'ApplicationApiAuth');
      const userPool = new cognito.UserPool(authStack, 'UserPool');
      const userPoolClient = new cognito.UserPoolClient(authStack, 'UserPoolClient', { userPool });

      const stack = new ApplicationApiStack(app, 'ApplicationApiConfigured', {
        environment: 'dev',
        databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:db',
        databaseProxyEndpoint: 'db.local',
        databaseName: 'community_content',
        redisUrl: 'redis://cache.local:6379',
        config,
        userPool,
        userPoolClient,
        vpc,
        lambdaSecurityGroup,
      });

      const template = Template.fromStack(stack);
      const functions = template.findResources('AWS::Lambda::Function');
      const hasCorsCredentials = Object.values(functions).some((resource: any) => {
        const variables = resource.Properties?.Environment?.Variables ?? {};
        return variables.CORS_CREDENTIALS === 'true';
      });
      expect(hasCorsCredentials).toBe(true);
    });
  });

  describe('DatabaseStack environment handling', () => {
    it('throws when VPC_NAT_GATEWAYS is missing', () => {
      const app = new cdk.App();
      delete process.env.VPC_NAT_GATEWAYS;
      expect(() =>
        new DatabaseStack(app, 'DatabaseMissingNat', {
          environment: 'dev',
          databaseName: 'community_content',
          deletionProtection: false,
        })
      ).toThrow('VPC_NAT_GATEWAYS must be set to provision VPC egress');
    });

    it('throws when VPC_NAT_GATEWAYS is invalid', () => {
      const app = new cdk.App();
      process.env.VPC_NAT_GATEWAYS = 'invalid';
      expect(() =>
        new DatabaseStack(app, 'DatabaseInvalidNat', {
          environment: 'dev',
          databaseName: 'community_content',
          deletionProtection: false,
        })
      ).toThrow('VPC_NAT_GATEWAYS must be a valid number');
    });

    it('allows empty external API keys in non-production environments', () => {
      const app = new cdk.App();
      process.env.VPC_NAT_GATEWAYS = '1';
      delete process.env.YOUTUBE_API_KEY;
      delete process.env.GITHUB_TOKEN;

      const stack = new DatabaseStack(app, 'DatabaseAllowEmptyKeys', {
        environment: 'dev',
        databaseName: 'community_content',
        deletionProtection: false,
      });
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::SecretsManager::Secret', 3);
    });

    it('requires external API keys in production environments', () => {
      const app = new cdk.App();
      process.env.VPC_NAT_GATEWAYS = '1';
      delete process.env.YOUTUBE_API_KEY;
      expect(() =>
        new DatabaseStack(app, 'DatabaseRequireKeys', {
          environment: 'prod',
          databaseName: 'community_content',
          deletionProtection: true,
        })
      ).toThrow('YOUTUBE_API_KEY must be set');
    });
  });

  describe('StaticSiteStack domain handling', () => {
    it('derives hosted zone name for subdomains', () => {
      const app = new cdk.App();
      const stack = new StaticSiteStack(app, 'StaticSiteSubdomain', {
        environment: 'dev',
        domainName: 'app.dev.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
      });

      const template = Template.fromStack(stack);
      const hostedZones = template.findResources('AWS::Route53::HostedZone');
      const zoneNames = Object.values(hostedZones).map((resource: any) => resource.Properties?.Name);
      expect(zoneNames.some((name: string) => name.startsWith('dev.example.com'))).toBe(true);
    });
  });

  describe('CognitoStack threat protection handling', () => {
    it('supports audit custom threat protection', () => {
      const app = new cdk.App();
      const config = {
        ...getEnvironmentConfig('dev'),
        cognito: {
          ...getEnvironmentConfig('dev').cognito,
          customThreatProtectionMode: 'AUDIT',
        },
      };
      new CognitoStack(app, 'CognitoAudit', { config });
    });

    it('supports enforced custom threat protection', () => {
      const app = new cdk.App();
      const config = {
        ...getEnvironmentConfig('dev'),
        cognito: {
          ...getEnvironmentConfig('dev').cognito,
          customThreatProtectionMode: 'ENFORCED',
        },
      };
      new CognitoStack(app, 'CognitoEnforced', { config });
    });

    it('defaults to audit for unknown custom threat protection values', () => {
      const app = new cdk.App();
      const config = {
        ...getEnvironmentConfig('dev'),
        cognito: {
          ...getEnvironmentConfig('dev').cognito,
          customThreatProtectionMode: 'UNKNOWN',
        },
      };
      new CognitoStack(app, 'CognitoUnknown', { config });
    });
  });

  describe('Environment config handling', () => {
    it('returns environment config for known environments', () => {
      const config = getEnvironmentConfig('dev');
      expect(config.environment).toBe('dev');
      expect(config.lambda.environmentVariables).toHaveProperty('NODE_ENV', 'dev');
    });

    it('throws for unknown environments', () => {
      expect(() => getEnvironmentConfig('unknown')).toThrow('Unknown environment');
    });
  });
});
