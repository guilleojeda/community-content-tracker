import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CommunityContentApp } from '../../src/infrastructure/lib/community-content-app';

describe('CommunityContentApp', () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  describe('environment-specific configuration', () => {
    it('configures development infrastructure with cost-optimised defaults', () => {
      const communityApp = new CommunityContentApp(app, 'CommunityContentDev', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 0.5,
          MaxCapacity: 1,
        },
        DeletionProtection: false,
        BackupRetentionPeriod: 7,
      });

      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);
      siteTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          PriceClass: 'PriceClass_100',
        }),
      });
      siteTemplate.resourceCountIs('AWS::WAFv2::WebACL', 0);
    });

    it('enables production safeguards and WAF for production deployments', () => {
      const communityApp = new CommunityContentApp(app, 'CommunityContentProd', {
        environment: 'prod',
        databaseName: 'community_content',
        domainName: 'community-content.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/prod-cert',
        enableWaf: true,
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasResourceProperties('AWS::RDS::DBCluster', {
        ServerlessV2ScalingConfiguration: {
          MinCapacity: 1,
          MaxCapacity: 4,
        },
        DeletionProtection: true,
        BackupRetentionPeriod: 30,
      });

      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);
      siteTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          PriceClass: 'PriceClass_All',
          Aliases: ['community-content.example.com'],
          WebACLId: Match.anyValue(),
        }),
      });
      siteTemplate.resourceCountIs('AWS::WAFv2::WebACL', 1);
    });
  });

  describe('stack outputs and environment wiring', () => {
    it('exports stack names for downstream stacks', () => {
      const communityApp = new CommunityContentApp(app, 'CommunityContentDev', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      const dbTemplate = Template.fromStack(communityApp.databaseStack);
      dbTemplate.hasOutput('DatabaseStackName', {
        Value: 'CommunityContentHub-Database-Dev',
        Export: {
          Name: 'CommunityContentHub-Database-Dev-StackName',
        },
      });

      const siteTemplate = Template.fromStack(communityApp.staticSiteStack);
      siteTemplate.hasOutput('StaticSiteStackName', {
        Value: 'CommunityContentHub-StaticSite-Dev',
        Export: {
          Name: 'CommunityContentHub-StaticSite-Dev-StackName',
        },
      });
    });

    it('derives account and region from environment variables when omitted', () => {
      const originalEnv = { ...process.env };
      process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
      process.env.CDK_DEFAULT_REGION = 'us-east-1';

      const communityApp = new CommunityContentApp(app, 'CommunityContentEnv', {
        environment: 'dev',
        databaseName: 'community_content',
      });

      expect(communityApp.databaseStack.account).toBe('123456789012');
      expect(communityApp.databaseStack.region).toBe('us-east-1');

      process.env = originalEnv;
    });
  });
});
