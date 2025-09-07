import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DatabaseStack } from './stacks/database-stack';
import { StaticSiteStack } from './stacks/static-site-stack';

export interface CommunityContentAppProps {
  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;

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

  /**
   * AWS account ID (optional, uses CDK_DEFAULT_ACCOUNT if not provided)
   */
  account?: string;

  /**
   * AWS region (optional, uses CDK_DEFAULT_REGION if not provided)
   */
  region?: string;
}

/**
 * Main CDK construct for AWS Community Content Hub
 * 
 * This construct orchestrates all the infrastructure stacks needed
 * for the Community Content Hub application.
 */
export class CommunityContentApp extends Construct {
  public readonly databaseStack: DatabaseStack;
  public readonly staticSiteStack: StaticSiteStack;

  constructor(scope: Construct, id: string, props: CommunityContentAppProps) {
    super(scope, id);

    const { environment } = props;
    const isProd = environment === 'prod';
    const isStaging = environment === 'staging';

    // Common stack properties
    const commonProps: cdk.StackProps = {
      env: {
        account: props.account || process.env.CDK_DEFAULT_ACCOUNT,
        region: props.region || process.env.CDK_DEFAULT_REGION || 'us-east-1',
      },
      description: `Community Content Hub ${environment} infrastructure`,
      tags: {
        Environment: environment,
        Project: 'community-content-hub',
        Owner: 'aws-community',
        CreatedBy: 'cdk',
      },
    };

    // Create Database Stack
    this.databaseStack = new DatabaseStack(this, `Database-${this.capitalizeFirst(environment)}`, {
      ...commonProps,
      stackName: `CommunityContentHub-Database-${this.capitalizeFirst(environment)}`,
      environment,
      deletionProtection: isProd,
      backupRetentionDays: isProd ? 30 : isStaging ? 14 : 7,
      minCapacity: isProd ? 1 : 0.5,
      maxCapacity: isProd ? 4 : isStaging ? 2 : 1,
    });

    // Create Static Site Stack
    this.staticSiteStack = new StaticSiteStack(this, `StaticSite-${this.capitalizeFirst(environment)}`, {
      ...commonProps,
      stackName: `CommunityContentHub-StaticSite-${this.capitalizeFirst(environment)}`,
      environment,
      domainName: props.domainName,
      certificateArn: props.certificateArn,
      enableWaf: props.enableWaf || isProd,
    });

    // Add cross-stack references if needed in future sprints
    // For Sprint 1, these stacks are independent

    // Add stack dependencies for proper deployment order
    // Currently no dependencies needed between database and static site
    // This will change in later sprints when we add API Gateway and Lambda functions

    // Output cross-stack references for future use
    this.exportStackOutputs();
  }

  /**
   * Export important outputs that might be needed by other stacks or external systems
   */
  private exportStackOutputs(): void {
    // Database outputs (for future API stack)
    new cdk.CfnOutput(this.databaseStack, 'DatabaseStackName', {
      value: this.databaseStack.stackName,
      exportName: `CommunityContentHub-${this.databaseStack.node.id}-StackName`,
      description: 'Database stack name for cross-stack references',
    });

    // Static site outputs (for future API stack and deployment)
    new cdk.CfnOutput(this.staticSiteStack, 'StaticSiteStackName', {
      value: this.staticSiteStack.stackName,
      exportName: `CommunityContentHub-${this.staticSiteStack.node.id}-StackName`,
      description: 'Static site stack name for cross-stack references',
    });
  }

  /**
   * Utility function to capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

/**
 * Environment-specific configuration helper
 */
export class EnvironmentConfig {
  /**
   * Get environment-specific configuration
   */
  static getConfig(environment: string) {
    const configs = {
      dev: {
        deletionProtection: false,
        backupRetentionDays: 7,
        minCapacity: 0.5,
        maxCapacity: 1,
        enableWaf: false,
        priceClass: 'PriceClass_100',
      },
      staging: {
        deletionProtection: false,
        backupRetentionDays: 14,
        minCapacity: 0.5,
        maxCapacity: 2,
        enableWaf: false,
        priceClass: 'PriceClass_100',
      },
      prod: {
        deletionProtection: true,
        backupRetentionDays: 30,
        minCapacity: 1,
        maxCapacity: 4,
        enableWaf: true,
        priceClass: 'PriceClass_All',
      },
    };

    return configs[environment as keyof typeof configs] || configs.dev;
  }

  /**
   * Validate environment-specific domain configuration
   */
  static validateDomainConfig(environment: string, domainName?: string, certificateArn?: string): void {
    if (environment === 'prod') {
      if (!domainName || !certificateArn) {
        throw new Error('Production environment requires both domainName and certificateArn');
      }
    }

    if (domainName && !certificateArn) {
      throw new Error('certificateArn is required when domainName is provided');
    }

    if (certificateArn && !domainName) {
      throw new Error('domainName is required when certificateArn is provided');
    }
  }
}