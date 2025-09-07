import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StaticSiteStack } from '../../src/infrastructure/lib/stacks/static-site-stack';

describe('StaticSiteStack', () => {
  let app: cdk.App;
  let stack: StaticSiteStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
  });

  describe('when creating development environment', () => {
    beforeEach(() => {
      stack = new StaticSiteStack(app, 'TestStaticSiteStack', {
        environment: 'dev',
        domainName: 'dev.community-content.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
      });
      template = Template.fromStack(stack);
    });

    it('should create S3 bucket for static site hosting', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        WebsiteConfiguration: {
          IndexDocument: 'index.html',
          ErrorDocument: 'error.html',
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('should create CloudFront distribution', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https',
            Compress: true,
            CachePolicyId: Match.anyValue(),
          },
          Origins: Match.arrayWith([{
            DomainName: Match.anyValue(),
            Id: Match.anyValue(),
            S3OriginConfig: {
              OriginAccessIdentity: Match.anyValue(),
            },
          }]),
          Aliases: ['dev.community-content.example.com'],
          ViewerCertificate: {
            AcmCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
            SslSupportMethod: 'sni-only',
            MinimumProtocolVersion: 'TLSv1.2_2021',
          },
          Enabled: true,
          HttpVersion: 'http2',
          PriceClass: 'PriceClass_100',
        },
      });
    });

    it('should create Origin Access Identity for S3 bucket access', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessIdentity', {
        OriginAccessIdentityConfig: {
          Comment: Match.stringLikeRegexp('.*community.*content.*'),
        },
      });
    });

    it('should create bucket policy allowing CloudFront access', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([{
            Effect: 'Allow',
            Principal: {
              AWS: Match.anyValue(),
            },
            Action: 's3:GetObject',
            Resource: Match.anyValue(),
          }]),
        },
      });
    });

    it('should configure cache behaviors for different content types', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            {
              PathPattern: '/api/*',
              ViewerProtocolPolicy: 'redirect-to-https',
              CachePolicyId: Match.anyValue(), // No caching for API calls
            },
            {
              PathPattern: '*.js',
              ViewerProtocolPolicy: 'redirect-to-https',
              CachePolicyId: Match.anyValue(), // Long cache for JS files
            },
            {
              PathPattern: '*.css',
              ViewerProtocolPolicy: 'redirect-to-https',
              CachePolicyId: Match.anyValue(), // Long cache for CSS files
            },
          ]),
        },
      });
    });

    it('should have proper cost tracking tags', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        Tags: Match.arrayWith([
          {
            Key: 'Environment',
            Value: 'dev',
          },
          {
            Key: 'Project',
            Value: 'community-content-hub',
          },
          {
            Key: 'Component',
            Value: 'frontend',
          },
        ]),
      });
    });

    it('should output important resources', () => {
      template.hasOutput('S3BucketName', {
        Description: 'S3 bucket name for static site hosting',
      });

      template.hasOutput('CloudFrontDistributionId', {
        Description: 'CloudFront distribution ID',
      });

      template.hasOutput('CloudFrontDomainName', {
        Description: 'CloudFront distribution domain name',
      });

      template.hasOutput('WebsiteURL', {
        Description: 'Website URL',
      });
    });
  });

  describe('when creating production environment', () => {
    beforeEach(() => {
      stack = new StaticSiteStack(app, 'TestProdStaticSiteStack', {
        environment: 'prod',
        domainName: 'community-content.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/prod-cert-id',
        enableWaf: true,
      });
      template = Template.fromStack(stack);
    });

    it('should use global price class for production', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          PriceClass: 'PriceClass_All',
        },
      });
    });

    it('should create WAF Web ACL when enabled', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: 'CLOUDFRONT',
        DefaultAction: {
          Allow: {},
        },
        Rules: Match.arrayWith([
          {
            Name: 'AWSManagedRulesCommonRuleSet',
            Priority: 1,
            OverrideAction: { None: {} },
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesCommonRuleSet',
              },
            },
          },
        ]),
      });
    });

    it('should associate WAF with CloudFront distribution', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          WebACLId: Match.anyValue(),
        },
      });
    });
  });

  describe('when validating security configuration', () => {
    beforeEach(() => {
      stack = new StaticSiteStack(app, 'TestSecurityStack', {
        environment: 'dev',
        domainName: 'dev.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
      });
      template = Template.fromStack(stack);
    });

    it('should block all public access to S3 bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('should enforce HTTPS only', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https',
          },
        },
      });
    });

    it('should use minimum TLS 1.2', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          ViewerCertificate: {
            MinimumProtocolVersion: 'TLSv1.2_2021',
          },
        },
      });
    });

    it('should set security headers', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            StrictTransportSecurity: {
              AccessControlMaxAgeSec: 63072000,
              IncludeSubdomains: true,
            },
            ContentTypeOptions: {
              Override: true,
            },
            FrameOptions: {
              FrameOption: 'DENY',
              Override: true,
            },
            ReferrerPolicy: {
              ReferrerPolicy: 'strict-origin-when-cross-origin',
              Override: true,
            },
          },
        },
      });
    });
  });

  describe('when validating caching configuration', () => {
    beforeEach(() => {
      stack = new StaticSiteStack(app, 'TestCachingStack', {
        environment: 'dev',
        domainName: 'dev.example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
      });
      template = Template.fromStack(stack);
    });

    it('should create optimized cache policies', () => {
      // No cache policy for API calls
      template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
        CachePolicyConfig: {
          Name: Match.stringLikeRegexp('.*NoCache.*'),
          DefaultTTL: 0,
          MaxTTL: 1,
        },
      });

      // Long cache policy for static assets
      template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
        CachePolicyConfig: {
          Name: Match.stringLikeRegexp('.*StaticAssets.*'),
          DefaultTTL: 86400, // 1 day
          MaxTTL: 31536000, // 1 year
        },
      });
    });

    it('should enable compression for all content', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            Compress: true,
          },
          CacheBehaviors: Match.arrayWith([
            {
              Compress: true,
            },
          ]),
        },
      });
    });
  });

  describe('when creating without certificate', () => {
    it('should create distribution without custom domain', () => {
      stack = new StaticSiteStack(app, 'TestNoCertStack', {
        environment: 'dev',
      });
      template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Aliases: Match.absent(),
          ViewerCertificate: {
            CloudFrontDefaultCertificate: true,
          },
        },
      });
    });
  });
});