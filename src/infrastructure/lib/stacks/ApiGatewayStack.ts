import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ApiGatewayStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  authorizerLambda: lambda.IFunction;
  registerLambda: lambda.IFunction;
  loginLambda: lambda.IFunction;
  refreshLambda: lambda.IFunction;
  verifyEmailLambda: lambda.IFunction;
  resendVerificationLambda: lambda.IFunction;
  forgotPasswordLambda: lambda.IFunction;
  resetPasswordLambda: lambda.IFunction;
  channelCreateLambda: lambda.IFunction;
  channelListLambda: lambda.IFunction;
  channelUpdateLambda: lambda.IFunction;
  channelDeleteLambda: lambda.IFunction;
  channelSyncLambda: lambda.IFunction;
  searchLambda?: lambda.IFunction;
  statsLambda?: lambda.IFunction;
  environment: string;
  enableTracing?: boolean;
  adminDashboardLambda: lambda.IFunction;
  adminUserManagementLambda: lambda.IFunction;
  adminBadgesLambda: lambda.IFunction;
  adminModerationLambda: lambda.IFunction;
  adminAuditLogLambda: lambda.IFunction;
  analyticsTrackLambda: lambda.IFunction;
  analyticsUserLambda: lambda.IFunction;
  analyticsExportLambda: lambda.IFunction;
  exportCsvLambda: lambda.IFunction;
  exportHistoryLambda: lambda.IFunction;
  contentFindDuplicatesLambda: lambda.IFunction;
  userExportLambda: lambda.IFunction;
  userDeleteAccountLambda: lambda.IFunction;
  userUpdateProfileLambda: lambda.IFunction;
  userUpdatePreferencesLambda: lambda.IFunction;
  userManageConsentLambda: lambda.IFunction;
  userBadgesLambda: lambda.IFunction;
  userGetCurrentLambda: lambda.IFunction;
  userGetByUsernameLambda: lambda.IFunction;
  userContentLambda: lambda.IFunction;
  feedbackIngestLambda: lambda.IFunction;
  allowedOrigins?: string[];
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.RequestAuthorizer | undefined;
  private readonly authorizerLambda: lambda.IFunction;
  private readonly registerLambda: lambda.IFunction;
  private readonly loginLambda: lambda.IFunction;
  private readonly refreshLambda: lambda.IFunction;
  private readonly verifyEmailLambda: lambda.IFunction;
  private readonly resendVerificationLambda: lambda.IFunction;
  private readonly forgotPasswordLambda: lambda.IFunction;
  private readonly resetPasswordLambda: lambda.IFunction;
  private readonly envName: string;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    this.envName = props.environment;
    const enableTracing = props.enableTracing ?? true;
    const productionLikeEnvs = new Set(['prod', 'blue', 'green']);
    const isProductionLike = productionLikeEnvs.has(this.envName);

    const parseBooleanEnv = (name: string): boolean | null => {
      const value = process.env[name];
      if (!value || value.trim().length === 0) {
        return null;
      }
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        return false;
      }
      throw new Error(`${name} must be a boolean value`);
    };

    const parseNumberEnv = (name: string): number | null => {
      const raw = process.env[name];
      if (!raw || raw.trim().length === 0) {
        return null;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a valid number`);
      }
      return parsed;
    };

    const dataTraceEnabled = parseBooleanEnv('API_GW_DATA_TRACE_ENABLED') ?? !isProductionLike;
    const throttlingRateLimit = parseNumberEnv('API_GW_THROTTLE_RATE_LIMIT') ?? 100;
    const throttlingBurstLimit = parseNumberEnv('API_GW_THROTTLE_BURST_LIMIT') ?? 200;

    if (
      !props.authorizerLambda ||
      !props.registerLambda ||
      !props.loginLambda ||
      !props.refreshLambda ||
      !props.verifyEmailLambda ||
      !props.resendVerificationLambda ||
      !props.forgotPasswordLambda ||
      !props.resetPasswordLambda
    ) {
      throw new Error('ApiGatewayStack requires auth lambda integrations');
    }

    const importLambda = (id: string, fn: lambda.IFunction): lambda.IFunction =>
      lambda.Function.fromFunctionAttributes(this, id, {
        functionArn: fn.functionArn,
        sameEnvironment: true,
      });
    const importOptionalLambda = (id: string, fn?: lambda.IFunction): lambda.IFunction | undefined =>
      fn
        ? lambda.Function.fromFunctionAttributes(this, id, {
            functionArn: fn.functionArn,
            sameEnvironment: true,
          })
        : undefined;

    this.authorizerLambda = importLambda('AuthorizerLambdaImport', props.authorizerLambda);
    this.registerLambda = importLambda('RegisterLambdaImport', props.registerLambda);
    this.loginLambda = importLambda('LoginLambdaImport', props.loginLambda);
    this.refreshLambda = importLambda('RefreshLambdaImport', props.refreshLambda);
    this.verifyEmailLambda = importLambda('VerifyEmailLambdaImport', props.verifyEmailLambda);
    this.resendVerificationLambda = importLambda('ResendVerificationLambdaImport', props.resendVerificationLambda);
    this.forgotPasswordLambda = importLambda('ForgotPasswordLambdaImport', props.forgotPasswordLambda);
    this.resetPasswordLambda = importLambda('ResetPasswordLambdaImport', props.resetPasswordLambda);

    const channelCreateLambda = importLambda('ChannelCreateLambdaImport', props.channelCreateLambda);
    const channelListLambda = importLambda('ChannelListLambdaImport', props.channelListLambda);
    const channelUpdateLambda = importLambda('ChannelUpdateLambdaImport', props.channelUpdateLambda);
    const channelDeleteLambda = importLambda('ChannelDeleteLambdaImport', props.channelDeleteLambda);
    const channelSyncLambda = importLambda('ChannelSyncLambdaImport', props.channelSyncLambda);
    const searchLambda = importOptionalLambda('SearchLambdaImport', props.searchLambda);
    const statsLambda = importOptionalLambda('StatsLambdaImport', props.statsLambda);
    const adminDashboardLambda = importLambda('AdminDashboardLambdaImport', props.adminDashboardLambda);
    const adminUserManagementLambda = importLambda('AdminUserManagementLambdaImport', props.adminUserManagementLambda);
    const adminBadgesLambda = importLambda('AdminBadgesLambdaImport', props.adminBadgesLambda);
    const adminModerationLambda = importLambda('AdminModerationLambdaImport', props.adminModerationLambda);
    const adminAuditLogLambda = importLambda('AdminAuditLogLambdaImport', props.adminAuditLogLambda);
    const analyticsTrackLambda = importLambda('AnalyticsTrackLambdaImport', props.analyticsTrackLambda);
    const analyticsUserLambda = importLambda('AnalyticsUserLambdaImport', props.analyticsUserLambda);
    const analyticsExportLambda = importLambda('AnalyticsExportLambdaImport', props.analyticsExportLambda);
    const exportCsvLambda = importLambda('ExportCsvLambdaImport', props.exportCsvLambda);
    const exportHistoryLambda = importLambda('ExportHistoryLambdaImport', props.exportHistoryLambda);
    const contentFindDuplicatesLambda = importLambda('ContentFindDuplicatesLambdaImport', props.contentFindDuplicatesLambda);
    const userExportLambda = importLambda('UserExportLambdaImport', props.userExportLambda);
    const userDeleteAccountLambda = importLambda('UserDeleteAccountLambdaImport', props.userDeleteAccountLambda);
    const userUpdateProfileLambda = importLambda('UserUpdateProfileLambdaImport', props.userUpdateProfileLambda);
    const userUpdatePreferencesLambda = importLambda('UserUpdatePreferencesLambdaImport', props.userUpdatePreferencesLambda);
    const userManageConsentLambda = importLambda('UserManageConsentLambdaImport', props.userManageConsentLambda);
    const userBadgesLambda = importLambda('UserBadgesLambdaImport', props.userBadgesLambda);
    const userGetCurrentLambda = importLambda('UserGetCurrentLambdaImport', props.userGetCurrentLambda);
    const userGetByUsernameLambda = importLambda('UserGetByUsernameLambdaImport', props.userGetByUsernameLambda);
    const userContentLambda = importLambda('UserContentLambdaImport', props.userContentLambda);
    const feedbackIngestLambda = importLambda('FeedbackIngestLambdaImport', props.feedbackIngestLambda);

    const allowedOrigins = this.resolveAllowedOrigins(props.allowedOrigins);

    // Create API Gateway REST API with X-Ray tracing
    this.api = new apigateway.RestApi(this, 'CommunityContentTrackerApi', {
      restApiName: `community-content-tracker-api-${this.envName}`,
      description: 'AWS Community Content Hub API',
      deployOptions: {
        stageName: this.envName,
        tracingEnabled: enableTracing,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled,
        metricsEnabled: true,
        throttlingRateLimit,
        throttlingBurstLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'Origin',
        ],
        allowCredentials: true,
      },
    });

    // Note: Authorizer is created lazily in addProtectedResource() to avoid
    // "Authorizer must be attached to a RestApi" validation error when
    // no protected endpoints are defined in the constructor

    // Create request validators
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      requestValidatorName: 'validate-body-and-params',
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // Auth endpoints resource
    const authResource = this.api.root.addResource('auth');

    // Request models for validation
    const registerModel = new apigateway.Model(this, 'RegisterRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'RegisterRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['email', 'password', 'username'],
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
            format: 'email',
            minLength: 3,
            maxLength: 255,
          },
          password: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 12,
            maxLength: 128,
          },
          username: {
            type: apigateway.JsonSchemaType.STRING,
            pattern: '^[a-zA-Z0-9_-]{3,30}$',
          },
        },
      },
    });

    const loginModel = new apigateway.Model(this, 'LoginRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'LoginRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['email', 'password'],
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
            format: 'email',
          },
          password: {
            type: apigateway.JsonSchemaType.STRING,
          },
        },
      },
    });

    const refreshModel = new apigateway.Model(this, 'RefreshRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'RefreshRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['refreshToken'],
        properties: {
          refreshToken: {
            type: apigateway.JsonSchemaType.STRING,
          },
        },
      },
    });

    const verifyEmailModel = new apigateway.Model(this, 'VerifyEmailRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'VerifyEmailRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['email', 'confirmationCode'],
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
            format: 'email',
          },
          confirmationCode: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 6,
            maxLength: 6,
            pattern: '^[0-9]{6}$',
          },
        },
      },
    });

    const emailOnlyModel = new apigateway.Model(this, 'EmailOnlyRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'EmailOnlyRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['email'],
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
            format: 'email',
          },
        },
      },
    });

    const resetPasswordModel = new apigateway.Model(this, 'ResetPasswordRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'ResetPasswordRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['email', 'confirmationCode', 'newPassword'],
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
            format: 'email',
          },
          confirmationCode: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 6,
            maxLength: 6,
            pattern: '^[0-9]{6}$',
          },
          newPassword: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 12,
            maxLength: 128,
          },
        },
      },
    });

    // POST /auth/register
    const registerResource = authResource.addResource('register');
    registerResource.addMethod('POST', new apigateway.LambdaIntegration(this.registerLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': registerModel,
      },
      methodResponses: [
        {
          statusCode: '201',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/login
    const loginResource = authResource.addResource('login');
    loginResource.addMethod('POST', new apigateway.LambdaIntegration(this.loginLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': loginModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '401',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/refresh
    const refreshResource = authResource.addResource('refresh');
    refreshResource.addMethod('POST', new apigateway.LambdaIntegration(this.refreshLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': refreshModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '401',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // GET /auth/verify-email
    const verifyEmailResource = authResource.addResource('verify-email');
    verifyEmailResource.addMethod('GET', new apigateway.LambdaIntegration(this.verifyEmailLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.code': true,
      },
      requestValidator,
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/verify-email
    verifyEmailResource.addMethod('POST', new apigateway.LambdaIntegration(this.verifyEmailLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': verifyEmailModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/resend-verification
    const resendVerificationResource = authResource.addResource('resend-verification');
    resendVerificationResource.addMethod('POST', new apigateway.LambdaIntegration(this.resendVerificationLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': emailOnlyModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/forgot-password
    const forgotPasswordResource = authResource.addResource('forgot-password');
    forgotPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(this.forgotPasswordLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': emailOnlyModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // POST /auth/reset-password
    const resetPasswordResource = authResource.addResource('reset-password');
    resetPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(this.resetPasswordLambda, {
      proxy: true,
      integrationResponses: [{
        statusCode: '200',
      }],
    }), {
      requestValidator,
      requestModels: {
        'application/json': resetPasswordModel,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '400',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // Create a usage plan for API rate limiting
    const usagePlan = new apigateway.UsagePlan(this, 'ApiUsagePlan', {
      name: `community-content-tracker-usage-plan-${this.envName}`,
      description: 'Usage plan for API rate limiting',
      apiStages: [
        {
          api: this.api,
          stage: this.api.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY,
      },
    });

    // Create API key for internal services (optional)
    const apiKey = new apigateway.ApiKey(this, 'InternalApiKey', {
      apiKeyName: `internal-api-key-${this.envName}`,
      description: 'API key for internal service communication',
    });

    usagePlan.addApiKey(apiKey);

    // CloudWatch Logs for API Gateway
    new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/aws/apigateway/community-content-tracker-${this.envName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Grant API Gateway permissions to write logs
    const apiGatewayLogRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });

    // Configure API Gateway account settings for CloudWatch logging
    const cfnAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayLogRole.roleArn,
    });

    this.api.deploymentStage.node.addDependency(cfnAccount);

    // Add X-Ray tracing configuration for Lambdas
    if (enableTracing) {
      // X-Ray tracing is enabled via lambda.Tracing enum
      // Set on individual Lambda functions using:
      // tracing: lambda.Tracing.ACTIVE

      // Note: Lambda functions should have X-Ray tracing enabled in their configurations
      // This is typically done when creating the Lambda functions
    }

    // Channel Management API Routes (Protected - require authentication)
    const channelsResource = this.api.root.addResource('channels');

    // POST /channels - Create new channel
    channelsResource.addMethod('POST', new apigateway.LambdaIntegration(channelCreateLambda, {
      proxy: true,
    }), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.createAuthorizerIfNeeded(),
      requestValidator,
      methodResponses: [
        { statusCode: '201', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    // GET /channels - List user's channels
    channelsResource.addMethod('GET', new apigateway.LambdaIntegration(channelListLambda, {
      proxy: true,
    }), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.createAuthorizerIfNeeded(),
      methodResponses: [
        { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    // /channels/:id resource
    const channelIdResource = channelsResource.addResource('{id}');

    // PUT /channels/:id - Update channel
    channelIdResource.addMethod('PUT', new apigateway.LambdaIntegration(channelUpdateLambda, {
      proxy: true,
    }), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.createAuthorizerIfNeeded(),
      requestValidator,
      methodResponses: [
        { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '403', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    // DELETE /channels/:id - Delete channel
    channelIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(channelDeleteLambda, {
      proxy: true,
    }), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.createAuthorizerIfNeeded(),
      methodResponses: [
        { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '403', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    // POST /channels/:id/sync - Manual sync trigger
    const syncResource = channelIdResource.addResource('sync');
    syncResource.addMethod('POST', new apigateway.LambdaIntegration(channelSyncLambda, {
      proxy: true,
    }), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.createAuthorizerIfNeeded(),
      methodResponses: [
        { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '403', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    const authorizerInstance = this.createAuthorizerIfNeeded();

    const defaultProtectedResponses: apigateway.MethodResponse[] = [
      { statusCode: '200' },
      { statusCode: '400' },
      { statusCode: '401' },
      { statusCode: '403' },
      { statusCode: '404' },
      { statusCode: '500' },
    ];

    const protectedOptions = (overrides?: Partial<apigateway.MethodOptions>): apigateway.MethodOptions => ({
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: authorizerInstance,
      methodResponses: overrides?.methodResponses ?? defaultProtectedResponses,
      ...overrides,
    });

    const adminResource = this.api.root.addResource('admin');
    const adminDashboardIntegration = new apigateway.LambdaIntegration(adminDashboardLambda, {
      proxy: true,
    });

    const dashboardResource = adminResource.addResource('dashboard');
    dashboardResource.addResource('stats').addMethod('GET', adminDashboardIntegration, protectedOptions());
    dashboardResource.addResource('system-health').addMethod('GET', adminDashboardIntegration, protectedOptions());

    const adminUsersResource = adminResource.addResource('users');
    const adminUserIntegration = new apigateway.LambdaIntegration(adminUserManagementLambda, { proxy: true });
    adminUsersResource.addMethod('GET', adminUserIntegration, protectedOptions());
    adminUsersResource.addResource('export').addMethod('POST', adminUserIntegration, protectedOptions());

    const adminUserIdResource = adminUsersResource.addResource('{id}');
    adminUserIdResource.addMethod('GET', adminUserIntegration, protectedOptions());
    adminUserIdResource.addResource('aws-employee').addMethod(
      'PUT',
      new apigateway.LambdaIntegration(adminBadgesLambda, { proxy: true }),
      protectedOptions()
    );

    const adminBadgesResource = adminResource.addResource('badges');
    const adminBadgesIntegration = new apigateway.LambdaIntegration(adminBadgesLambda, { proxy: true });
    adminBadgesResource.addMethod('POST', adminBadgesIntegration, protectedOptions());
    adminBadgesResource.addMethod('DELETE', adminBadgesIntegration, protectedOptions());
    adminBadgesResource.addResource('bulk').addMethod('POST', adminBadgesIntegration, protectedOptions());
    adminBadgesResource
      .addResource('history')
      .addResource('{userId}')
      .addMethod('GET', adminBadgesIntegration, protectedOptions());

    adminResource
      .addResource('audit-log')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(adminAuditLogLambda, { proxy: true }),
        protectedOptions()
      );

    const adminContentResource = adminResource.addResource('content');
    const adminModerationIntegration = new apigateway.LambdaIntegration(adminModerationLambda, { proxy: true });
    adminContentResource.addResource('flagged').addMethod('GET', adminModerationIntegration, protectedOptions());
    const adminContentIdResource = adminContentResource.addResource('{id}');
    adminContentIdResource.addMethod('DELETE', adminModerationIntegration, protectedOptions());
    adminContentIdResource.addResource('flag').addMethod('PUT', adminModerationIntegration, protectedOptions());
    adminContentIdResource.addResource('moderate').addMethod('PUT', adminModerationIntegration, protectedOptions());

    const analyticsResource = this.api.root.addResource('analytics');
    analyticsResource
      .addResource('track')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(analyticsTrackLambda, { proxy: true }),
        {
          authorizationType: apigateway.AuthorizationType.NONE,
          methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '500' }],
        }
      );

    const analyticsUserResource = analyticsResource.addResource('user');
    analyticsUserResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(analyticsUserLambda, { proxy: true }),
      protectedOptions()
    );

    analyticsResource
      .addResource('export')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(analyticsExportLambda, { proxy: true }),
        protectedOptions({
          methodResponses: [
            { statusCode: '200' },
            { statusCode: '401' },
            { statusCode: '500' },
          ],
        })
      );

    const exportResource = this.api.root.addResource('export');
    exportResource.addResource('csv').addMethod(
      'POST',
      new apigateway.LambdaIntegration(exportCsvLambda, { proxy: true }),
      protectedOptions({
        methodResponses: [
          { statusCode: '200' },
          { statusCode: '401' },
          { statusCode: '500' },
        ],
      })
    );

    exportResource.addResource('history').addMethod(
      'GET',
      new apigateway.LambdaIntegration(exportHistoryLambda, { proxy: true }),
      protectedOptions()
    );

    const contentResource = this.api.root.addResource('content');
    contentResource.addResource('duplicates').addMethod(
      'GET',
      new apigateway.LambdaIntegration(contentFindDuplicatesLambda, { proxy: true }),
      protectedOptions()
    );

    const usersResource = this.api.root.addResource('users');
    const userMeResource = usersResource.addResource('me');
    const userIdResource = usersResource.addResource('{id}');

    userMeResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userGetCurrentLambda, { proxy: true }),
      protectedOptions()
    );

    userIdResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(userDeleteAccountLambda, { proxy: true }),
      protectedOptions()
    );

    userIdResource.addMethod(
      'PATCH',
      new apigateway.LambdaIntegration(userUpdateProfileLambda, { proxy: true }),
      protectedOptions({
        requestValidator,
      })
    );

    const userExportResource = userIdResource.addResource('export');
    userExportResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userExportLambda, { proxy: true }),
      protectedOptions()
    );

    const userPreferencesResource = userIdResource.addResource('preferences');
    userPreferencesResource.addMethod(
      'PATCH',
      new apigateway.LambdaIntegration(userUpdatePreferencesLambda, { proxy: true }),
      protectedOptions({
        requestValidator,
      })
    );

    const userBadgesResource = userIdResource.addResource('badges');
    userBadgesResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userBadgesLambda, { proxy: true }),
      {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [
          { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
          { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        ],
      }
    );

    const userMeBadgesResource = userMeResource.addResource('badges');
    userMeBadgesResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userBadgesLambda, { proxy: true }),
      protectedOptions()
    );

    const userContentResource = userIdResource.addResource('content');
    userContentResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userContentLambda, { proxy: true }),
      {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [
          { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
          { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '401', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        ],
      }
    );

    const userUsernameResource = usersResource.addResource('username');
    const userByUsernameResource = userUsernameResource.addResource('{username}');
    userByUsernameResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userGetByUsernameLambda, { proxy: true }),
      {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [
          { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
          { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '404', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        ],
      }
    );

    const userResource = this.api.root.addResource('user');
    const consentResource = userResource.addResource('consent');

    const consentIntegration = new apigateway.LambdaIntegration(userManageConsentLambda, { proxy: true });

    consentResource.addMethod('POST', consentIntegration, protectedOptions({ requestValidator }));
    consentResource.addMethod('GET', consentIntegration, protectedOptions());
    consentResource
      .addResource('check')
      .addMethod('POST', consentIntegration, protectedOptions({ requestValidator }));

    const feedbackResource = this.api.root.addResource('feedback');
    const feedbackIntegration = new apigateway.LambdaIntegration(feedbackIngestLambda, { proxy: true });

    feedbackResource.addMethod('POST', feedbackIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      methodResponses: [
        { statusCode: '202', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
        { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
      exportName: `community-content-tracker-api-endpoint-${this.envName}`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `community-content-tracker-api-id-${this.envName}`,
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'Internal API Key ID',
      exportName: `community-content-tracker-api-key-id-${this.envName}`,
    });

    // Public API endpoints (Sprint 5)
    if (searchLambda) {
      // GET /search - Public search endpoint
      const searchResource = this.api.root.addResource('search');
      searchResource.addMethod('GET', new apigateway.LambdaIntegration(searchLambda, {
        proxy: true,
      }), {
        authorizationType: apigateway.AuthorizationType.NONE,
        requestParameters: {
          'method.request.querystring.q': true,
          'method.request.querystring.limit': false,
          'method.request.querystring.offset': false,
          'method.request.querystring.type': false,
          'method.request.querystring.tags': false,
          'method.request.querystring.badges': false,
          'method.request.querystring.startDate': false,
          'method.request.querystring.endDate': false,
        },
        requestValidator,
        methodResponses: [
          { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
          { statusCode: '400', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
          { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        ],
      });
    }

    if (statsLambda) {
      // GET /stats - Public statistics endpoint
      const statsResource = this.api.root.addResource('stats');
      statsResource.addMethod('GET', new apigateway.LambdaIntegration(statsLambda, {
        proxy: true,
      }), {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [
          { statusCode: '200', responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL } },
          { statusCode: '500', responseModels: { 'application/json': apigateway.Model.ERROR_MODEL } },
        ],
      });
    }

    // Add tags
    cdk.Tags.of(this).add('Project', 'CommunityContentTracker');
    cdk.Tags.of(this).add('Component', 'ApiGateway');
    cdk.Tags.of(this).add('Environment', this.envName);
  }

  private resolveAllowedOrigins(override?: string[]): string[] {
    if (override && override.length > 0) {
      return override;
    }

    const raw = process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
    if (!raw || raw.trim().length === 0) {
      throw new Error('CORS_ORIGIN must be set');
    }

    const origins = raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (origins.length === 0) {
      throw new Error('CORS_ORIGIN must include at least one origin');
    }

    return origins;
  }

  /**
   * Lazily create the authorizer on first use
   */
  private createAuthorizerIfNeeded(): apigateway.RequestAuthorizer {
    if (!this.authorizer) {
      (this as any).authorizer = new apigateway.RequestAuthorizer(this, 'JwtAuthorizer', {
        handler: this.authorizerLambda,
        authorizerName: `jwt-authorizer-${this.envName}`,
        identitySources: [apigateway.IdentitySource.header('Authorization')],
        resultsCacheTtl: cdk.Duration.minutes(5),
      });
    }
    return this.authorizer!;
  }

  /**
   * Add a protected resource to the API that requires authentication
   */
  public addProtectedResource(
    path: string,
    lambdaFunction: lambda.IFunction,
    httpMethod: string = 'GET',
    _requireAdmin: boolean = false
  ): apigateway.Method {
    // Lazily create authorizer on first use to avoid validation error
    if (!this.authorizer) {
      (this as any).authorizer = new apigateway.RequestAuthorizer(this, 'JwtAuthorizer', {
        handler: this.authorizerLambda,
        authorizerName: `jwt-authorizer-${this.envName}`,
        identitySources: [apigateway.IdentitySource.header('Authorization')],
        resultsCacheTtl: cdk.Duration.minutes(5),
      });
    }

    const resource = this.api.root.resourceForPath(path) || this.api.root.addResource(path);

    const methodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.authorizer,
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: '401',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
        {
          statusCode: '403',
          responseModels: {
            'application/json': apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    };

    // Add admin check if required
    // Note: authorizationScopes is not available on standard authorizers
    // Admin check should be done in the authorizer Lambda or the target Lambda

    return resource.addMethod(
      httpMethod,
      new apigateway.LambdaIntegration(lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );
  }

  /**
   * Add a public resource to the API (no authentication required)
   */
  public addPublicResource(
    path: string,
    lambdaFunction: lambda.IFunction,
    httpMethod: string = 'GET'
  ): apigateway.Method {
    const resource = this.api.root.resourceForPath(path) || this.api.root.addResource(path);

    return resource.addMethod(
      httpMethod,
      new apigateway.LambdaIntegration(lambdaFunction, {
        proxy: true,
      }),
      {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [
          {
            statusCode: '200',
            responseModels: {
              'application/json': apigateway.Model.EMPTY_MODEL,
            },
          },
          {
            statusCode: '400',
            responseModels: {
              'application/json': apigateway.Model.ERROR_MODEL,
            },
          },
        ],
      }
    );
  }
}
