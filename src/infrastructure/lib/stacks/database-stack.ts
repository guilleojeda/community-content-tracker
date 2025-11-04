import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';
import { PgVectorEnabler } from '../constructs/pgvector-enabler';

export interface DatabaseStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, prod)
   */
  environment?: string;

  /**
   * Whether to enable deletion protection
   */
  deletionProtection?: boolean;

  /**
   * Backup retention period in days
   */
  backupRetentionDays?: number;

  /**
   * Min Aurora Serverless capacity
   */
  minCapacity?: number;

  /**
   * Max Aurora Serverless capacity
   */
  maxCapacity?: number;
}

/**
 * Database stack for AWS Community Content Hub
 * 
 * Creates:
 * - VPC with public and private subnets
 * - Aurora Serverless v2 PostgreSQL cluster with pgvector extension
 * - RDS Proxy for connection pooling
 * - Secrets Manager for database credentials
 * - Bastion host for development access
 * - Security groups and proper networking
 */
export class DatabaseStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly databaseSecret: secretsmanager.Secret;
  public readonly youtubeApiKeySecret: secretsmanager.Secret;
  public readonly githubTokenSecret: secretsmanager.Secret;
  public readonly bastionHost?: ec2.Instance;
  public readonly clusterEndpoint: string;
  public readonly proxyEndpoint: string;

  constructor(scope: Construct, id: string, props?: DatabaseStackProps) {
    super(scope, id, props);

    // Add cost tags
    cdk.Tags.of(this).add('Project', 'community-content-hub');
    cdk.Tags.of(this).add('Environment', props?.environment || 'dev');

    const environment = props?.environment || 'dev';
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(environment);

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'CommunityContentVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      natGateways: 1, // Reduce cost in dev, increase in prod
    });

    // Create security group for Aurora cluster
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Aurora database cluster',
      allowAllOutbound: true,
    });

    // Create security group for RDS Proxy
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS Proxy',
      allowAllOutbound: true,
    });

    // Create security group for Lambda functions
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Create security group for bastion host (only in non-prod)
    let bastionSecurityGroup: ec2.SecurityGroup | undefined;
    if (!isProductionLike) {
      bastionSecurityGroup = new ec2.SecurityGroup(this, 'BastionSecurityGroup', {
        vpc: this.vpc,
        description: 'Security group for bastion host',
        allowAllOutbound: true,
      });

      // Allow SSH access to bastion host
      bastionSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(22),
        'Allow SSH access'
      );
    }

    // Allow Lambda and Proxy to connect to database
    databaseSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda access to database'
    );

    databaseSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(5432),
      'Allow RDS Proxy access to database'
    );

    // Allow bastion host to connect to database (dev only)
    if (!isProductionLike && bastionSecurityGroup) {
      databaseSecurityGroup.addIngressRule(
        bastionSecurityGroup,
        ec2.Port.tcp(5432),
        'Allow bastion host access to database'
      );
    }

    // Create database credentials secret
    this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      description: 'Aurora Serverless database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        passwordLength: 32,
        excludeCharacters: '"@/\\',
      },
    });

    // Create YouTube API key secret (placeholder - should be set via CLI)
    this.youtubeApiKeySecret = new secretsmanager.Secret(this, 'YouTubeApiKeySecret', {
      description: 'YouTube Data API v3 key for content scraping',
      secretName: `youtube-api-key-${environment}`,
      secretStringValue: cdk.SecretValue.unsafePlainText(process.env.YOUTUBE_API_KEY ?? ''),
    });
    const youtubeRotationFunction = this.createExternalApiKeyRotationFunction(
      'YouTubeApiKeyRotationFunction',
      this.youtubeApiKeySecret,
      `/${environment}/api-keys/youtube/pending`,
      'YouTube API key'
    );
    this.youtubeApiKeySecret.addRotationSchedule('YouTubeApiKeyRotationSchedule', {
      rotationLambda: youtubeRotationFunction,
      automaticallyAfter: cdk.Duration.days(isProductionLike ? 30 : 60),
    });

    // Create GitHub token secret (placeholder - should be set via CLI)
    this.githubTokenSecret = new secretsmanager.Secret(this, 'GitHubTokenSecret', {
      description: 'GitHub personal access token for content scraping',
      secretName: `github-token-${environment}`,
      secretStringValue: cdk.SecretValue.unsafePlainText(process.env.GITHUB_TOKEN ?? ''),
    });
    const githubRotationFunction = this.createExternalApiKeyRotationFunction(
      'GitHubTokenRotationFunction',
      this.githubTokenSecret,
      `/${environment}/api-keys/github/pending`,
      'GitHub access token'
    );
    this.githubTokenSecret.addRotationSchedule('GitHubTokenRotationSchedule', {
      rotationLambda: githubRotationFunction,
      automaticallyAfter: cdk.Duration.days(isProductionLike ? 30 : 60),
    });

    // Create DB subnet group
    const subnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      description: 'Subnet group for Aurora Serverless cluster',
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Create Aurora Serverless v2 cluster
    this.cluster = new rds.DatabaseCluster(this, 'DatabaseCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      vpc: this.vpc,
      subnetGroup,
      securityGroups: [databaseSecurityGroup],
      enableDataApi: true,
      serverlessV2MinCapacity: props?.minCapacity ?? (isProductionLike ? 1 : 0.5),
      serverlessV2MaxCapacity: props?.maxCapacity ?? (isProductionLike ? 4 : 1),
      backup: {
        retention: cdk.Duration.days(props?.backupRetentionDays ?? (isProductionLike ? 30 : 7)),
        preferredWindow: '03:00-04:00',
      },
      preferredMaintenanceWindow: 'Sun:04:00-Sun:05:00',
      deletionProtection: props?.deletionProtection ?? isProductionLike,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: isProductionLike ? cdk.aws_logs.RetentionDays.ONE_MONTH : cdk.aws_logs.RetentionDays.ONE_WEEK,
      defaultDatabaseName: 'community_content',
      writer: rds.ClusterInstance.serverlessV2('writer'),
    });

    if (environment !== 'dev') {
      const rotationInterval = isProductionLike ? cdk.Duration.days(30) : cdk.Duration.days(60);
      this.cluster.addRotationSingleUser({
        automaticallyAfter: rotationInterval,
      });
    }

    // Create RDS Proxy for connection pooling
    this.proxy = new rds.DatabaseProxy(this, 'DatabaseProxy', {
      proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
      secrets: [this.databaseSecret],
      vpc: this.vpc,
      securityGroups: [proxySecurityGroup],
      requireTLS: true,
      idleClientTimeout: cdk.Duration.seconds(1800),
    });

    // Enable pgvector extension
    const pgvectorEnabler = new PgVectorEnabler(this, 'PgVectorEnabler', {
      cluster: this.cluster,
      databaseSecret: this.databaseSecret,
      vpc: this.vpc,
      securityGroups: [lambdaSecurityGroup],
      databaseName: 'community_content',
    });

    // Create bastion host for development access (only in non-prod environments)
    if (!isProductionLike) {
      const bastionRole = new iam.Role(this, 'BastionRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        ],
      });

      this.bastionHost = new ec2.Instance(this, 'BastionHost', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        machineImage: ec2.MachineImage.latestAmazonLinux2(),
        vpc: this.vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        securityGroup: bastionSecurityGroup!,
        role: bastionRole,
        userData: ec2.UserData.custom(`#!/bin/bash
yum update -y
yum install -y postgresql15
echo 'export PGHOST=${this.cluster.clusterEndpoint.hostname}' >> /home/ec2-user/.bashrc
echo 'export PGPORT=5432' >> /home/ec2-user/.bashrc
echo 'export PGDATABASE=community_content' >> /home/ec2-user/.bashrc
echo 'export PGUSER=postgres' >> /home/ec2-user/.bashrc
`),
      });
    }

    // Store endpoints for easy access
    this.clusterEndpoint = this.cluster.clusterEndpoint.socketAddress;
    this.proxyEndpoint = this.proxy.endpoint;

    // Create SSM parameters for database configuration
    new ssm.StringParameter(this, 'DatabaseEndpointParameter', {
      parameterName: `/${environment}/database/endpoint`,
      stringValue: this.cluster.clusterEndpoint.socketAddress,
      description: 'Aurora cluster endpoint',
    });

    new ssm.StringParameter(this, 'DatabaseProxyEndpointParameter', {
      parameterName: `/${environment}/database/proxy-endpoint`,
      stringValue: this.proxy.endpoint,
      description: 'RDS Proxy endpoint',
    });

    new ssm.StringParameter(this, 'DatabaseSecretArnParameter', {
      parameterName: `/${environment}/database/secret-arn`,
      stringValue: this.databaseSecret.secretArn,
      description: 'Database credentials secret ARN',
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for the database infrastructure',
    });

    new cdk.CfnOutput(this, 'DatabaseClusterEndpoint', {
      value: this.cluster.clusterEndpoint.socketAddress,
      description: 'Aurora cluster endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseClusterIdentifier', {
      value: this.cluster.clusterIdentifier,
      description: 'Aurora cluster identifier',
    });

    new cdk.CfnOutput(this, 'RDSProxyEndpoint', {
      value: this.proxy.endpoint,
      description: 'RDS Proxy endpoint for connection pooling',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'Secrets Manager ARN for database credentials',
    });

    if (this.bastionHost) {
      new cdk.CfnOutput(this, 'BastionHostInstanceId', {
        value: this.bastionHost.instanceId,
        description: 'Bastion host instance ID for database access',
      });
    }

    new cdk.CfnOutput(this, 'DatabaseSecurityGroupId', {
      value: databaseSecurityGroup.securityGroupId,
      description: 'Security group ID for database access',
    });

    // Add tags based on environment
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Project', 'community-content-hub');
    cdk.Tags.of(this).add('Component', 'database');
  }

  private createExternalApiKeyRotationFunction(
    id: string,
    secret: secretsmanager.Secret,
    pendingParameterName: string,
    alias: string
  ): lambda.Function {
    const functionTimeout = cdk.Duration.seconds(30);
    const rotationFunction = new lambda.Function(this, id, {
      description: `Secrets Manager rotation for ${alias}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/api-key-rotation')),
      timeout: functionTimeout,
      memorySize: 256,
      environment: {
        PENDING_PARAMETER_NAME: pendingParameterName,
        SECRET_ALIAS: alias,
      },
    });

    rotationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:DescribeSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:UpdateSecretVersionStage',
          'secretsmanager:GetSecretValue',
        ],
        resources: [secret.secretArn],
      })
    );

    const parameterArn = cdk.Stack.of(this).formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: pendingParameterName.startsWith('/')
        ? pendingParameterName.slice(1)
        : pendingParameterName,
    });

    rotationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:DeleteParameter'],
        resources: [parameterArn],
      })
    );

    return rotationFunction;
  }
}
