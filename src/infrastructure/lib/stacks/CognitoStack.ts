import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

interface CognitoStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly adminGroup: cognito.CfnUserPoolGroup;
  public readonly preSignupLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Validate configuration
    this.validateConfiguration(config);

    // Create pre-signup Lambda for username validation
    this.preSignupLambda = this.createPreSignupLambda(config);

    // Create Cognito User Pool (without Lambda trigger first)
    this.userPool = this.createUserPool(config);

    // Configure Lambda permissions and attach trigger
    this.configureUserPoolLambdaIntegration();

    // Create User Pool Client
    this.userPoolClient = this.createUserPoolClient(config);

    // Create Cognito Domain for hosted UI (required for OAuth flows)
    this.createCognitoDomain(config);

    // Create Admin Group
    this.adminGroup = this.createAdminGroup(config);

    // Create CloudFormation outputs
    this.createOutputs(config);

    // Apply tags to all resources
    this.applyTags(config);
  }

  private validateConfiguration(config: EnvironmentConfig): void {
    if (config.cognito.passwordPolicy.minLength < 8) {
      throw new Error('Password minimum length must be at least 8 characters');
    }
    if (config.cognito.passwordPolicy.minLength > 128) {
      throw new Error('Password minimum length cannot exceed 128 characters');
    }
  }

  private createPreSignupLambda(config: EnvironmentConfig): lambda.Function {
    const preSignupLambdaCode = `
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event, context, callback) => {
    console.log('Pre-signup trigger event:', JSON.stringify(event, null, 2));

    try {
        const { userAttributes } = event.request;
        const customUsername = userAttributes['custom:username'];

        // Validate username format
        if (customUsername) {
            // Username validation rules:
            // - 3-50 characters
            // - Alphanumeric and underscores only
            // - Must start with letter
            const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,49}$/;

            if (!usernameRegex.test(customUsername)) {
                const error = new Error('Username must be 3-50 characters, start with a letter, and contain only letters, numbers, and underscores');
                error.name = 'InvalidParameterException';
                throw error;
            }

            // Check for username uniqueness
            // Note: In production, this would query the database
            // For now, we'll just validate format
            console.log('Username validation passed for:', customUsername);
        }

        // Validate default_visibility
        const defaultVisibility = userAttributes['custom:default_visibility'];
        if (defaultVisibility) {
            const validVisibilities = ['private', 'aws_only', 'aws_community', 'public'];
            if (!validVisibilities.includes(defaultVisibility)) {
                const error = new Error('default_visibility must be one of: private, aws_only, aws_community, public');
                error.name = 'InvalidParameterException';
                throw error;
            }
        }

        // Validate is_admin
        const isAdmin = userAttributes['custom:is_admin'];
        if (isAdmin && !['true', 'false'].includes(isAdmin)) {
            const error = new Error('is_admin must be either true or false');
            error.name = 'InvalidParameterException';
            throw error;
        }

        // Auto-confirm user if email verification is handled elsewhere
        event.response.autoConfirmUser = false;
        event.response.autoVerifyEmail = true;

        callback(null, event);
    } catch (error) {
        console.error('Pre-signup validation failed:', error);
        callback(error);
    }
};`;

    const lambdaRole = new iam.Role(this, 'PreSignupLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      // Cognito permissions will be added after User Pool creation
    });

    const preSignupLambda = new lambda.Function(this, 'PreSignupLambda', {
      functionName: `community-content-tracker-${config.environment}-pre-signup`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: lambdaRole,
      code: lambda.Code.fromInline(preSignupLambdaCode),
      timeout: cdk.Duration.seconds(config.lambda.timeout),
      memorySize: config.lambda.memorySize,
      tracing: config.lambda.tracing === 'Active' ? lambda.Tracing.ACTIVE : lambda.Tracing.PASS_THROUGH,
      environment: {
        ...config.lambda.environmentVariables,
        // USER_POOL_ID will be set after User Pool creation
      },
      description: 'Pre-signup trigger for username validation and user attribute processing',
    });

    return preSignupLambda;
  }

  private createUserPool(config: EnvironmentConfig): cognito.UserPool {
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `community-content-tracker-${config.environment}`,

      // Sign-in configuration
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },

      // Username configuration
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },

      // Custom attributes
      customAttributes: {
        username: new cognito.StringAttribute({
          minLen: 3,
          maxLen: 50,
          mutable: true,
        }),
        default_visibility: new cognito.StringAttribute({
          minLen: 1,
          maxLen: 20,
          mutable: true,
        }),
        is_admin: new cognito.StringAttribute({
          minLen: 4,
          maxLen: 5,
          mutable: true,
        }),
      },

      // Password policy
      passwordPolicy: {
        minLength: config.cognito.passwordPolicy.minLength,
        requireLowercase: config.cognito.passwordPolicy.requireLowercase,
        requireUppercase: config.cognito.passwordPolicy.requireUppercase,
        requireDigits: config.cognito.passwordPolicy.requireNumbers,
        requireSymbols: config.cognito.passwordPolicy.requireSymbols,
        tempPasswordValidity: cdk.Duration.days(config.cognito.passwordPolicy.tempPasswordValidityDays),
      },

      // MFA configuration
      mfa: this.mapMfaConfiguration(config.cognito.mfaConfiguration),
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },

      // Advanced security mode - only enable for production with Plus feature plan
      // For development, we'll skip advanced security to avoid additional costs
      ...(config.environment === 'prod' ? {} : { advancedSecurityMode: cognito.AdvancedSecurityMode.OFF }),

      // Email configuration - using Cognito default
      email: cognito.UserPoolEmail.withCognito(),

      // Email verification
      userVerification: {
        emailSubject: 'Verify your AWS Community Content Tracker account',
        emailBody: 'Hello! Welcome to AWS Community Content Tracker. Please click the link below to verify your email address: {##Verify Email##}',
        emailStyle: cognito.VerificationEmailStyle.LINK,
      },

      // Account recovery
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Lambda triggers will be added after configuration

      // Case sensitivity
      signInCaseSensitive: false,

      // Deletion protection
      deletionProtection: config.cognito.deletionProtection,

      // Device tracking
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: false,
      },
    });

    // Lambda permissions and integration will be configured after User Pool creation

    return userPool;
  }

  private configureUserPoolLambdaIntegration(): void {
    // Grant Lambda permission to be invoked by Cognito - using low-level to avoid dependency cycle
    new lambda.CfnPermission(this, 'CognitoInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: this.preSignupLambda.functionName,
      principal: 'cognito-idp.amazonaws.com',
      sourceArn: this.userPool.userPoolArn,
    });

    // Add Lambda trigger to User Pool using low-level CfnUserPool
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.lambdaConfig = {
      preSignUp: this.preSignupLambda.functionArn,
    };
  }

  private createUserPoolClient(config: EnvironmentConfig): cognito.UserPoolClient {
    return new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `community-content-tracker-${config.environment}-client`,

      // Auth flows
      authFlows: {
        userSrp: true,
        userPassword: true,
        custom: false,
        adminUserPassword: false,
      },

      // Security
      generateSecret: false, // For web applications
      preventUserExistenceErrors: true,

      // Token validity
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),

      // Supported identity providers
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],

      // OAuth settings for web application
      oAuth: {
        flows: {
          authorizationCodeGrant: true,  // Enable for secure server-side auth
          implicitCodeGrant: true,       // Enable for SPA/client-side auth
          clientCredentials: false,      // Not needed for user auth
        },
        scopes: [
          cognito.OAuthScope.OPENID,     // Required for authentication
          cognito.OAuthScope.EMAIL,      // Access to email claims
          cognito.OAuthScope.PROFILE,    // Access to profile claims
          cognito.OAuthScope.COGNITO_ADMIN, // Admin API access
        ],
        callbackUrls: config.environment === 'prod'
          ? ['https://community-content-hub.aws.com/callback', 'https://community-content-hub.aws.com/auth/callback']
          : ['http://localhost:3000/callback', 'http://localhost:3000/auth/callback', 'http://localhost:3001/callback'],
        logoutUrls: config.environment === 'prod'
          ? ['https://community-content-hub.aws.com/', 'https://community-content-hub.aws.com/logout']
          : ['http://localhost:3000/', 'http://localhost:3000/logout', 'http://localhost:3001/'],
      },

      // Read/write attributes
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
        })
        .withCustomAttributes('username', 'default_visibility', 'is_admin'),

      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
        })
        .withCustomAttributes('username', 'default_visibility', 'is_admin'),
    });
  }

  private createCognitoDomain(config: EnvironmentConfig): void {
    // Create a unique domain prefix for the Cognito hosted UI
    const domainPrefix = `community-content-hub-${config.environment}-${cdk.Stack.of(this).account}`;

    const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: domainPrefix.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      },
    });

    // Output the domain URL
    new cdk.CfnOutput(this, 'UserPoolDomainUrl', {
      value: `https://${userPoolDomain.domainName}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Domain URL',
      exportName: `community-content-tracker-hosted-ui-domain-${config.environment}`,
    });
  }

  private createAdminGroup(config: EnvironmentConfig): cognito.CfnUserPoolGroup {
    // Create IAM role for admin group
    const adminRole = new iam.Role(this, 'AdminGroupRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          'StringEquals': {
            'cognito-identity.amazonaws.com:aud': '', // Will be set by Cognito Identity Pool
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'IAM role for admin users in Cognito User Pool',
      inlinePolicies: {
        AdminPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminListGroupsForUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:ListUsers',
                'cognito-idp:ListGroups',
              ],
              resources: [this.userPool.userPoolArn],
            }),
          ],
        }),
      },
    });

    return new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator users with full access',
      precedence: 1,
      roleArn: adminRole.roleArn,
    });
  }

  private createOutputs(config: EnvironmentConfig): void {
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `community-content-tracker-${config.environment}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `community-content-tracker-${config.environment}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `community-content-tracker-${config.environment}-UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'AdminGroupName', {
      value: this.adminGroup.groupName!,
      description: 'Admin user group name',
      exportName: `community-content-tracker-${config.environment}-AdminGroupName`,
    });

    new cdk.CfnOutput(this, 'PreSignupLambdaArn', {
      value: this.preSignupLambda.functionArn,
      description: 'Pre-signup Lambda function ARN',
      exportName: `community-content-tracker-${config.environment}-PreSignupLambdaArn`,
    });
  }

  private applyTags(config: EnvironmentConfig): void {
    const tags = {
      ...config.tags,
      Environment: config.environment,
      Component: 'Authentication',
    };

    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, String(value));
    });
  }

  private mapMfaConfiguration(mfaConfig: string): cognito.Mfa {
    switch (mfaConfig) {
      case 'OFF':
        return cognito.Mfa.OFF;
      case 'OPTIONAL':
        return cognito.Mfa.OPTIONAL;
      case 'REQUIRED':
        return cognito.Mfa.REQUIRED;
      default:
        throw new Error(`Invalid MFA configuration: ${mfaConfig}`);
    }
  }

  private mapAdvancedSecurityMode(securityMode: string): cognito.AdvancedSecurityMode {
    switch (securityMode) {
      case 'OFF':
        return cognito.AdvancedSecurityMode.OFF;
      case 'AUDIT':
        return cognito.AdvancedSecurityMode.AUDIT;
      case 'ENFORCED':
        return cognito.AdvancedSecurityMode.ENFORCED;
      default:
        return cognito.AdvancedSecurityMode.AUDIT; // Default to AUDIT instead of throwing
    }
  }
}