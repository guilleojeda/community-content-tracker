import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CommunityContentApp } from '../../src/infrastructure/lib/community-content-app';
import * as environments from '../../src/infrastructure/lib/config/environments';
import type { EnvironmentConfig } from '../../src/infrastructure/lib/config/environments';

describe('CommunityContentApp', () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when creating development environment', () => {
    it('should create all required stacks for development', () => {
      const communityApp = new CommunityContentApp(app, 'TestCommunityApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      // Should have database and static site stacks
      expect(communityApp.databaseStack).toBeDefined();
      expect(communityApp.staticSiteStack).toBeDefined();

      // Stacks should be properly named
      expect(communityApp.databaseStack.stackName).toBe('CommunityContentHub-Database-Dev');
      expect(communityApp.staticSiteStack.stackName).toBe('CommunityContentHub-StaticSite-Dev');
    });

    it('should have proper dependencies between stacks', () => {
      const communityApp = new CommunityContentApp(app, 'TestCommunityApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      // Static site stack should not depend on database stack for now
      // (they are independent in Sprint 1)
      expect(communityApp.staticSiteStack.dependencies).toEqual([]);
    });

    it('should use development configuration', () => {
      const communityApp = new CommunityContentApp(app, 'TestCommunityApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);

      // Database should have dev settings
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 1,
        },
        DeletionProtection: false,
      });

      // CloudFront should use cost-optimized price class
      siteTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          PriceClass: 'PriceClass_100',
        },
      });
    });
  });

  describe('when creating production environment', () => {
    it('should create production-ready configuration', () => {
      const communityApp = new CommunityContentApp(app, 'TestProdApp', {
        environment: 'prod',
        databaseName: 'community_content',
        domainName: 'community-content.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/prod-cert',
        enableWaf: true,
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);

      // Database should have prod settings
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 1,
          MaxCapacity: 4,
        },
        DeletionProtection: true,
        BackupRetentionPeriod: 30,
      });

      // CloudFront should use global price class
      siteTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          PriceClass: 'PriceClass_All',
          Aliases: ['community-content.example.com'],
        },
      });

      // Should have WAF enabled
      siteTemplate.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: 'CLOUDFRONT',
      });
    });
  });

  describe('when creating staging environment', () => {
    it('should create staging configuration', () => {
      const communityApp = new CommunityContentApp(app, 'TestStagingApp', {
        environment: 'staging',
        databaseName: 'community_content',
        domainName: 'staging.community-content.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/staging-cert',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);

      // Database should have staging settings (between dev and prod)
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 2,
        },
        BackupRetentionPeriod: 14,
        DeletionProtection: false,
      });
    });
  });

  describe('when validating cross-stack outputs', () => {
    it('should export necessary values for other stacks', () => {
      const communityApp = new CommunityContentApp(app, 'TestOutputApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);

      // Database stack should export VPC and security group info
      dbTemplate.hasOutput('VpcId', {});
      dbTemplate.hasOutput('DatabaseSecurityGroupId', {});

      // Static site stack should export distribution info (matching actual output names)
      siteTemplate.hasOutput('DistributionId', {});
      siteTemplate.hasOutput('BucketName', {});
    });
  });

  describe('when validating environment-specific account and region', () => {
    it('should use environment variables for account and region', () => {
      // Mock environment variables
      const originalEnv = process.env;
      process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
      process.env.CDK_DEFAULT_REGION = 'us-east-1';

      const communityApp = new CommunityContentApp(app, 'TestEnvApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      expect(communityApp.databaseStack.account).toBe('123456789012');
      expect(communityApp.databaseStack.region).toBe('us-east-1');

      // Restore original environment
      process.env = originalEnv;
    });

    it('should prefer explicit account and region props when provided', () => {
      const communityApp = new CommunityContentApp(app, 'TestExplicitEnvApp', {
        environment: 'dev',
        databaseName: 'community_content',
        account: '999999999999',
        region: 'eu-west-1',
      });

      expect(communityApp.databaseStack.account).toBe('999999999999');
      expect(communityApp.databaseStack.region).toBe('eu-west-1');
    });
  });

  describe('when config values are missing, fall back to environment defaults', () => {
    const buildFallbackConfig = (environment: string, isProductionLike: boolean): EnvironmentConfig => ({
      environment,
      isProductionLike,
      deletionProtection: undefined,
      backupRetentionDays: undefined,
      minCapacity: undefined,
      maxCapacity: undefined,
      enableWaf: undefined,
      tags: {
        Project: 'CommunityContentTracker',
      },
      cognito: {
        deletionProtection: false,
        mfaConfiguration: 'OFF',
        standardThreatProtectionMode: 'OFF',
        passwordPolicy: {
          minLength: 12,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSymbols: false,
          tempPasswordValidityDays: 7,
        },
      },
      lambda: {
        timeout: 30,
        memorySize: 256,
        tracing: 'PassThrough',
        environmentVariables: {},
      },
    });

    it('uses staging defaults when config omits retention and capacity', () => {
      jest.spyOn(environments, 'getEnvironmentConfig').mockReturnValue(
        buildFallbackConfig('staging', false)
      );

      const communityApp = new CommunityContentApp(app, 'FallbackStagingApp', {
        environment: 'staging',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        BackupRetentionPeriod: 14,
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 2,
        },
        DeletionProtection: false,
      });
    });

    it('uses production defaults when config omits retention and capacity', () => {
      jest.spyOn(environments, 'getEnvironmentConfig').mockReturnValue(
        buildFallbackConfig('prod', true)
      );

      const communityApp = new CommunityContentApp(app, 'FallbackProdApp', {
        environment: 'prod',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        BackupRetentionPeriod: 30,
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 1,
          MaxCapacity: 4,
        },
        DeletionProtection: true,
      });
    });

    it('uses dev defaults when config omits retention and capacity', () => {
      jest.spyOn(environments, 'getEnvironmentConfig').mockReturnValue(
        buildFallbackConfig('dev', false)
      );

      const communityApp = new CommunityContentApp(app, 'FallbackDevApp', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        BackupRetentionPeriod: 7,
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 1,
        },
        DeletionProtection: false,
      });
    });
  });
});
