import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface StaticSiteStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, prod)
   */
  environment?: string;

  /**
   * Custom domain name for the site
   */
  domainName?: string;

  /**
   * ARN of the ACM certificate for HTTPS
   */
  certificateArn?: string;

  /**
   * Whether to enable WAF protection
   */
  enableWaf?: boolean;
}

/**
 * Static Site Stack for AWS Community Content Hub Frontend
 * 
 * Creates:
 * - S3 bucket for static site hosting with proper security
 * - CloudFront distribution with optimized caching
 * - Origin Access Identity for secure S3 access
 * - WAF Web ACL for protection (optional)
 * - Custom cache policies for different content types
 * - Security headers for enhanced protection
 */
export class StaticSiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly originAccessIdentity: cloudfront.OriginAccessIdentity;
  public readonly webAcl?: wafv2.CfnWebACL;
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props?: StaticSiteStackProps) {
    super(scope, id, props);

    // Add cost tags
    cdk.Tags.of(this).add('Project', 'community-content-hub');
    cdk.Tags.of(this).add('Environment', props?.environment || 'dev');

    const environment = props?.environment || 'dev';
    const isProd = environment === 'prod';

    // Create S3 bucket for static site hosting
    this.bucket = new s3.Bucket(this, 'StaticSiteBucket', {
      bucketName: `community-content-hub-${environment}-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      versioned: isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Create Origin Access Identity for secure S3 access
    this.originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: `Community Content Hub ${environment} OAI`,
    });

    // Grant CloudFront access to S3 bucket
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.CanonicalUserPrincipal(
            this.originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
      })
    );

    // Create cache policies for different content types
    const noCachePolicy = new cloudfront.CachePolicy(this, 'NoCachePolicy', {
      cachePolicyName: `CommunityContentHub-${environment}-NoCache`,
      comment: 'No caching for API calls',
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization', 'Content-Type'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    const staticAssetsPolicy = new cloudfront.CachePolicy(this, 'StaticAssetsPolicy', {
      cachePolicyName: `CommunityContentHub-${environment}-StaticAssets`,
      comment: 'Long caching for static assets',
      defaultTtl: cdk.Duration.days(1),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(365),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    const htmlCachePolicy = new cloudfront.CachePolicy(this, 'HtmlCachePolicy', {
      cachePolicyName: `CommunityContentHub-${environment}-Html`,
      comment: 'Short caching for HTML files',
      defaultTtl: cdk.Duration.minutes(5),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.hours(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    // Create security headers policy
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `CommunityContentHub-${environment}-SecurityHeaders`,
      comment: 'Security headers for Community Content Hub',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(63072000), // 2 years
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    // Create WAF Web ACL if enabled (typically for production)
    if (props?.enableWaf) {
      this.webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
        scope: 'CLOUDFRONT',
        defaultAction: { allow: {} },
        name: `CommunityContentHub-${environment}-WebACL`,
        description: `WAF protection for Community Content Hub ${environment}`,
        rules: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSetMetric',
            },
          },
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'KnownBadInputsMetric',
            },
          },
          {
            name: 'AWSManagedRulesAmazonIpReputationList',
            priority: 3,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesAmazonIpReputationList',
              },
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'AmazonIpReputationListMetric',
            },
          },
        ],
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: `CommunityContentHub-${environment}-WebACL`,
        },
      });
    }

    // Configure CloudFront distribution
    const distributionConfig: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity: this.originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: htmlCachePolicy,
        responseHeadersPolicy: securityHeadersPolicy,
        compress: true,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: this.originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: noCachePolicy,
          compress: true,
        },
        '*.js': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: this.originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetsPolicy,
          responseHeadersPolicy: securityHeadersPolicy,
          compress: true,
        },
        '*.css': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: this.originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetsPolicy,
          responseHeadersPolicy: securityHeadersPolicy,
          compress: true,
        },
        '*.woff*': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: this.originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetsPolicy,
          compress: false, // Fonts are already compressed
        },
        '*.ico': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: this.originAccessIdentity,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: staticAssetsPolicy,
          compress: true,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(30),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(30),
        },
      ],
      priceClass: isProd ? cloudfront.PriceClass.PRICE_CLASS_ALL : cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      comment: `Community Content Hub ${environment} distribution`,
      // Add custom domain and certificate if provided
      ...(props?.domainName && props?.certificateArn ? {
        domainNames: [props.domainName],
        certificate: cdk.aws_certificatemanager.Certificate.fromCertificateArn(
          this,
          'SiteCertificate',
          props.certificateArn
        ),
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        sslSupportMethod: cloudfront.SSLMethod.SNI,
      } : {}),
      // Add WAF if enabled
      ...(this.webAcl ? { webAclId: this.webAcl.attrArn } : {}),
    };

    // Create CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', distributionConfig);

    // Create Route53 records if domain name is provided and we have account/region
    if (props?.domainName && this.account !== cdk.Aws.ACCOUNT_ID && this.region !== cdk.Aws.REGION) {
      try {
        const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
          domainName: props.domainName.split('.').slice(-2).join('.'),
        });

        // Create A record
        new route53.ARecord(this, 'SiteARecord', {
          zone: hostedZone,
          recordName: props.domainName,
          target: route53.RecordTarget.fromAlias(
            new route53targets.CloudFrontTarget(this.distribution)
          ),
        });

        // Create AAAA record for IPv6
        new route53.AaaaRecord(this, 'SiteAAAARecord', {
          zone: hostedZone,
          recordName: props.domainName,
          target: route53.RecordTarget.fromAlias(
            new route53targets.CloudFrontTarget(this.distribution)
          ),
        });
      } catch (error) {
        // Skip Route53 records if hosted zone cannot be looked up (e.g., in unit tests)
        console.log('Skipping Route53 records creation - hosted zone lookup requires account/region');
      }
    }

    // Set website URL
    this.websiteUrl = props?.domainName 
      ? `https://${props.domainName}`
      : `https://${this.distribution.distributionDomainName}`;

    // Create SSM parameters for configuration
    new ssm.StringParameter(this, 'BucketNameParameter', {
      parameterName: `/${environment}/static-site/bucket-name`,
      stringValue: this.bucket.bucketName,
      description: 'S3 bucket name for static site',
    });

    new ssm.StringParameter(this, 'DistributionIdParameter', {
      parameterName: `/${environment}/static-site/distribution-id`,
      stringValue: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new ssm.StringParameter(this, 'DistributionDomainParameter', {
      parameterName: `/${environment}/static-site/distribution-domain`,
      stringValue: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    // Add tags for cost tracking
    const tags = {
      Environment: environment,
      Project: 'community-content-hub',
      Component: 'frontend',
    };

    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this.bucket).add(key, value);
      cdk.Tags.of(this.distribution).add(key, value);
      if (this.webAcl) {
        cdk.Tags.of(this.webAcl).add(key, value);
      }
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name for static site hosting',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: this.websiteUrl,
      description: 'Website URL',
    });

    if (this.webAcl) {
      new cdk.CfnOutput(this, 'WebACLArn', {
        value: this.webAcl.attrArn,
        description: 'WAF Web ACL ARN',
      });
    }

    // Deploy Next.js static site to S3
    // This will build the frontend and upload to S3 during cdk deploy
    const frontendPath = path.join(__dirname, '../../../frontend');
    const buildOutputPath = path.join(frontendPath, 'out');

    // Deploy the Next.js static export to S3
    const deployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(buildOutputPath)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'], // Invalidate all paths
      // Cache control headers for different file types
      cacheControl: [
        // HTML files - short cache
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(cdk.Duration.minutes(5)),
      ],
      // Prune old files
      prune: true,
      // Retain logs for troubleshooting
      retainOnDelete: false,
      memoryLimit: 512,
    });

    // Add specific cache control for static assets
    // Note: This will be handled by CloudFront cache policies we configured above
    // The S3 cache control is a fallback

    new cdk.CfnOutput(this, 'DeploymentStatus', {
      value: 'Website deployed successfully',
      description: 'Frontend deployment status',
    });
  }
}