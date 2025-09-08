import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CommunityContentApp } from '../../src/infrastructure/lib/community-content-app';

describe('CommunityContentApp', () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  describe('when creating development environment', () => {
    it('should create all required stacks for development', () => {
      const communityApp = new CommunityContentApp(app, 'TestCommunityApp', {
        environment: 'dev',
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
      });

      // Static site stack should not depend on database stack for now
      // (they are independent in Sprint 1)
      expect(communityApp.staticSiteStack.dependencies).toEqual([]);
    });

    it('should use development configuration', () => {
      const communityApp = new CommunityContentApp(app, 'TestCommunityApp', {
        environment: 'dev',
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
      });

      expect(communityApp.databaseStack.account).toBe('123456789012');
      expect(communityApp.databaseStack.region).toBe('us-east-1');

      // Restore original environment
      process.env = originalEnv;
    });
  });
});