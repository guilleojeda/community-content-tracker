import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';
import { PgVectorEnabler } from '../constructs/pgvector-enabler';

const requireEnv = (name: string, options?: { allowEmpty?: boolean }): string => {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value;
  }
  if (options?.allowEmpty) {
    return '';
  }
  throw new Error(`${name} must be set`);
};

const parseNumberEnv = (name: string): number | null => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }
  return parsed;
};

const resolveExternalApiKey = (name: string, allowEmpty: boolean): string => {
  return requireEnv(name, { allowEmpty });
};

export interface DatabaseStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;

  /**
   * Database name for the cluster
   */
  databaseName: string;

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

  /**
   * Number of NAT gateways to provision in the VPC
   */
  natGateways?: number;

}

/**
 * Database stack for AWS Community Content Hub
 * 
 * Creates:
 * - VPC with public and private subnets
 * - Aurora Serverless v2 PostgreSQL cluster with pgvector extension
 * - RDS Proxy for connection pooling
 * - Secrets Manager for database credentials
 * - Security groups and proper networking
 */
export class DatabaseStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly databaseSecret: secretsmanager.Secret;
  public readonly youtubeApiKeySecret: secretsmanager.Secret;
  public readonly githubTokenSecret: secretsmanager.Secret;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly clusterEndpoint: string;
  public readonly proxyEndpoint: string;
  public readonly redisEndpointAddress: string;
  public readonly redisEndpointPort: string;
  public readonly redisUrl: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Add cost tags
    cdk.Tags.of(this).add('Project', 'community-content-hub');
    cdk.Tags.of(this).add('Environment', props.environment);

    const environment = props.environment;
    const databaseName = props.databaseName;
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(environment);
    const allowEmptyExternalKeys = !isProductionLike;
    const natGateways = props.natGateways ?? parseNumberEnv('VPC_NAT_GATEWAYS');
    if (natGateways === null) {
      throw new Error('VPC_NAT_GATEWAYS must be set to provision VPC egress');
    }
    // Create VPC with public, private (egress), and isolated subnets
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
          name: 'PrivateEgress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'PrivateIsolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      natGateways,
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
    this.lambdaSecurityGroup = lambdaSecurityGroup;

    // Create security group for VPC endpoints
    const endpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for VPC interface endpoints',
      allowAllOutbound: true,
    });
    endpointSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(443),
      'Allow Lambda access to VPC interface endpoints'
    );

    // Create security group for Redis
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Redis cache',
      allowAllOutbound: true,
    });
    redisSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda access to Redis cache'
    );

    databaseSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(5432),
      'Allow RDS Proxy access to database'
    );

    proxySecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda access to RDS Proxy'
    );

    const endpointSubnets: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    };
    const gatewayEndpointSubnets: ec2.SubnetSelection[] = [
      { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    ];

    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: gatewayEndpointSubnets,
    });

    this.vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: gatewayEndpointSubnets,
    });

    const addInterfaceEndpoint = (id: string, service: ec2.IInterfaceVpcEndpointService) => {
      this.vpc.addInterfaceEndpoint(id, {
        service,
        subnets: endpointSubnets,
        securityGroups: [endpointSecurityGroup],
        privateDnsEnabled: true,
      });
    };

    addInterfaceEndpoint('SecretsManagerEndpoint', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER);
    addInterfaceEndpoint('SqsEndpoint', ec2.InterfaceVpcEndpointAwsService.SQS);
    addInterfaceEndpoint('LambdaEndpoint', ec2.InterfaceVpcEndpointAwsService.LAMBDA);
    addInterfaceEndpoint('CloudWatchEndpoint', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING);
    addInterfaceEndpoint('CloudWatchLogsEndpoint', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS);
    addInterfaceEndpoint('CognitoIdpEndpoint', new ec2.InterfaceVpcEndpointAwsService('cognito-idp'));
    addInterfaceEndpoint('BedrockRuntimeEndpoint', ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME);
    addInterfaceEndpoint('RdsDataEndpoint', ec2.InterfaceVpcEndpointAwsService.RDS_DATA);
    addInterfaceEndpoint('SesApiEndpoint', new ec2.InterfaceVpcEndpointAwsService('email'));

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

    // Create YouTube API key secret (provided via environment at deploy time)
    this.youtubeApiKeySecret = new secretsmanager.Secret(this, 'YouTubeApiKeySecret', {
      description: 'YouTube Data API v3 key for content scraping',
      secretName: `youtube-api-key-${environment}`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        resolveExternalApiKey('YOUTUBE_API_KEY', allowEmptyExternalKeys)
      ),
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

    // Create GitHub token secret (provided via environment at deploy time)
    this.githubTokenSecret = new secretsmanager.Secret(this, 'GitHubTokenSecret', {
      description: 'GitHub personal access token for content scraping',
      secretName: `github-token-${environment}`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        resolveExternalApiKey('GITHUB_TOKEN', allowEmptyExternalKeys)
      ),
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
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
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
      serverlessV2MinCapacity: props.minCapacity ?? (isProductionLike ? 1 : 0.5),
      serverlessV2MaxCapacity: props.maxCapacity ?? (isProductionLike ? 4 : 1),
      backup: {
        retention: cdk.Duration.days(props.backupRetentionDays ?? (isProductionLike ? 30 : 7)),
        preferredWindow: '03:00-04:00',
      },
      preferredMaintenanceWindow: 'Sun:04:00-Sun:05:00',
      deletionProtection: props.deletionProtection ?? isProductionLike,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: isProductionLike ? cdk.aws_logs.RetentionDays.ONE_MONTH : cdk.aws_logs.RetentionDays.ONE_WEEK,
      defaultDatabaseName: databaseName,
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
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      requireTLS: true,
      idleClientTimeout: cdk.Duration.seconds(1800),
    });

    // Enable pgvector extension
    new PgVectorEnabler(this, 'PgVectorEnabler', {
      cluster: this.cluster,
      databaseSecret: this.databaseSecret,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSecurityGroup],
      databaseName,
    });
    const redisSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnetIds;

    const redisCache = new elasticache.CfnServerlessCache(this, 'RedisServerlessCache', {
      serverlessCacheName: `community-content-hub-${environment}-cache`,
      description: `Valkey serverless cache for ${environment}`,
      engine: 'valkey',
      subnetIds: redisSubnets,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
    });

    // Store endpoints for easy access
    this.clusterEndpoint = this.cluster.clusterEndpoint.socketAddress;
    this.proxyEndpoint = this.proxy.endpoint;
    this.redisEndpointAddress = redisCache.attrEndpointAddress;
    this.redisEndpointPort = redisCache.attrEndpointPort;
    this.redisUrl = cdk.Fn.join('', [
      'redis://',
      this.redisEndpointAddress,
      ':',
      this.redisEndpointPort,
    ]);

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

    new ssm.StringParameter(this, 'RedisEndpointParameter', {
      parameterName: `/${environment}/cache/redis/endpoint`,
      stringValue: this.redisEndpointAddress,
      description: 'Redis cache endpoint address',
    });

    new ssm.StringParameter(this, 'RedisPortParameter', {
      parameterName: `/${environment}/cache/redis/port`,
      stringValue: this.redisEndpointPort,
      description: 'Redis cache endpoint port',
    });

    new ssm.StringParameter(this, 'RedisUrlParameter', {
      parameterName: `/${environment}/cache/redis/url`,
      stringValue: this.redisUrl,
      description: 'Redis cache connection URL',
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

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redisEndpointAddress,
      description: 'Redis cache endpoint address',
    });

    new cdk.CfnOutput(this, 'RedisPort', {
      value: this.redisEndpointPort,
      description: 'Redis cache endpoint port',
    });

    new cdk.CfnOutput(this, 'RedisUrl', {
      value: this.redisUrl,
      description: 'Redis cache connection URL',
    });

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
    const depsLockFilePath = path.join(__dirname, '../../../../package-lock.json');
    const rotationFunction = new NodejsFunction(this, id, {
      description: `Secrets Manager rotation for ${alias}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../lambdas/api-key-rotation/index.ts'),
      handler: 'handler',
      depsLockFilePath,
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
