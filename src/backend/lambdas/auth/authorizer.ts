import { Pool } from 'pg';
import { UserRepository } from '../../repositories/UserRepository';
import { verifyJwtToken, TokenVerifierConfig } from './tokenVerifier';
import {
  extractTokenFromHeader,
  isAdminOnlyEndpoint,
  checkRateLimit,
  getUserBadges,
  generatePolicyDocument,
  validateMethodArn,
  parseMethodArn,
  getContentAccessLevel,
  logSecurityEvent,
  detectSuspiciousActivity,
  PolicyDocument,
  RateLimitInfo,
  UserBadge
} from './utils';

/**
 * API Gateway Authorizer Event
 */
export interface AuthorizerEvent {
  type: string;
  methodArn: string;
  resource: string;
  path: string;
  httpMethod: string;
  headers: { [key: string]: string };
  multiValueHeaders: { [key: string]: string[] };
  queryStringParameters: { [key: string]: string } | null;
  multiValueQueryStringParameters: { [key: string]: string[] } | null;
  pathParameters: { [key: string]: string } | null;
  stageVariables: { [key: string]: string } | null;
  requestContext: {
    resourceId: string;
    resourcePath: string;
    httpMethod: string;
    extendedRequestId: string;
    requestTime: string;
    path: string;
    accountId: string;
    protocol: string;
    stage: string;
    domainPrefix: string;
    requestTimeEpoch: number;
    requestId: string;
    identity: {
      cognitoIdentityPoolId: string | null;
      accountId: string | null;
      cognitoIdentityId: string | null;
      caller: string | null;
      sourceIp: string;
      principalOrgId: string | null;
      accessKey: string | null;
      cognitoAuthenticationType: string | null;
      cognitoAuthenticationProvider: string | null;
      userArn: string | null;
      userAgent: string;
      user: string | null;
    };
    domainName: string;
    apiId: string;
  };
  body: string | null;
  isBase64Encoded: boolean;
}

/**
 * Authorizer context that will be passed to the backend
 */
export interface AuthorizerContext {
  userId: string;
  username: string;
  email: string;
  isAdmin: string; // String because API Gateway context values must be strings
  isAwsEmployee: string;
  badges: string; // JSON string of user badges
  rateLimitRemaining?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Authorizer result
 */
export interface AuthorizerResult {
  principalId: string;
  policyDocument: PolicyDocument;
  context: AuthorizerContext;
}

/**
 * User context enriched with badges and permissions
 */
export interface UserContextEnriched {
  userId: string;
  username: string;
  email: string;
  isAdmin: boolean;
  isAwsEmployee: boolean;
  badges: UserBadge[];
  rateLimitInfo?: RateLimitInfo;
}

/**
 * Authorizer configuration
 */
export interface AuthorizerConfig {
  cognitoUserPoolId: string;
  cognitoRegion: string;
  allowedAudiences: string[];
  issuer: string;
  rateLimitPerHour: number;
  dbConnectionString: string;
}

/**
 * Database connection pool (singleton)
 */
let dbPool: Pool | null = null;

/**
 * Get database pool instance
 */
function getDbPool(connectionString: string): Pool {
  if (!dbPool) {
    dbPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return dbPool;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): AuthorizerConfig {
  const requiredVars = [
    'COGNITO_USER_POOL_ID',
    'COGNITO_REGION',
    'ALLOWED_AUDIENCES',
    'DATABASE_URL',
  ];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID!,
    cognitoRegion: process.env.COGNITO_REGION!,
    allowedAudiences: process.env.ALLOWED_AUDIENCES!.split(','),
    issuer: `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
    rateLimitPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '1000', 10),
    dbConnectionString: process.env.DATABASE_URL!,
  };
}

/**
 * Create unauthorized response
 */
function createUnauthorizedResponse(
  methodArn: string,
  error: string,
  details?: string
): AuthorizerResult {
  logSecurityEvent({
    eventType: 'AUTHENTICATION_FAILED',
    resource: methodArn,
    details: details || error,
    timestamp: new Date(),
  });

  return {
    principalId: 'unauthorized',
    policyDocument: generatePolicyDocument('Deny', methodArn),
    context: {
      error,
      userId: '',
      username: '',
      email: '',
      isAdmin: 'false',
      isAwsEmployee: 'false',
      badges: '[]',
    },
  };
}

/**
 * Enrich user context with badges and permissions
 */
async function enrichUserContext(
  userId: string,
  userRepository: UserRepository,
  config: AuthorizerConfig
): Promise<Partial<UserContextEnriched>> {
  try {
    // Get user badges
    const badges = await getUserBadges(userId, userRepository);

    // Check rate limit
    const rateLimitInfo = await checkRateLimit(userId, config.rateLimitPerHour);

    return {
      badges,
      rateLimitInfo,
    };

  } catch (error) {
    console.error('Failed to enrich user context:', error);
    // Return minimal context if enrichment fails
    return {
      badges: [],
    };
  }
}

/**
 * Main Lambda handler for API Gateway authorization
 */
export async function handler(event: AuthorizerEvent): Promise<AuthorizerResult> {
  try {
    console.log('Authorizer event:', JSON.stringify(event, null, 2));

    // Validate method ARN
    if (!validateMethodArn(event.methodArn)) {
      return createUnauthorizedResponse(
        event.methodArn,
        'INVALID_REQUEST',
        'Invalid method ARN format'
      );
    }

    // Load configuration
    let config: AuthorizerConfig;
    try {
      config = loadConfig();
    } catch (configError: any) {
      return createUnauthorizedResponse(
        event.methodArn,
        'CONFIGURATION_ERROR',
        configError.message
      );
    }

    // Extract token from Authorization header
    const token = extractTokenFromHeader(event.headers.Authorization);
    if (!token) {
      return createUnauthorizedResponse(
        event.methodArn,
        'MISSING_TOKEN',
        'Authorization header missing or malformed'
      );
    }

    // Setup database connection
    const pool = getDbPool(config.dbConnectionString);
    const userRepository = new UserRepository(pool);

    // Verify JWT token
    const tokenConfig: TokenVerifierConfig = {
      cognitoUserPoolId: config.cognitoUserPoolId,
      cognitoRegion: config.cognitoRegion,
      allowedAudiences: config.allowedAudiences,
      issuer: config.issuer,
    };

    const tokenResult = await verifyJwtToken(token, tokenConfig, userRepository);

    if (!tokenResult.isValid || !tokenResult.user) {
      return createUnauthorizedResponse(
        event.methodArn,
        tokenResult.error?.code || 'AUTHENTICATION_FAILED',
        tokenResult.error?.details
      );
    }

    const user = tokenResult.user;

    // Check admin privileges for admin-only endpoints
    if (isAdminOnlyEndpoint(event.resource) && !user.isAdmin) {
      logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS',
        userId: user.id,
        ipAddress: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
        resource: event.resource,
        details: 'Non-admin user attempted to access admin endpoint',
        timestamp: new Date(),
      });

      return createUnauthorizedResponse(
        event.methodArn,
        'PERMISSION_DENIED',
        'Admin privileges required for this endpoint'
      );
    }

    // Enrich user context
    const enrichedContext = await enrichUserContext(user.id, userRepository, config);

    // Check rate limit
    if (enrichedContext.rateLimitInfo && !enrichedContext.rateLimitInfo.allowed) {
      logSecurityEvent({
        eventType: 'RATE_LIMIT_EXCEEDED',
        userId: user.id,
        ipAddress: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
        resource: event.resource,
        details: `Rate limit exceeded: ${config.rateLimitPerHour} requests per hour`,
        timestamp: new Date(),
      });

      return createUnauthorizedResponse(
        event.methodArn,
        'RATE_LIMIT_EXCEEDED',
        'Too many requests'
      );
    }

    // Detect suspicious activity
    const suspiciousActivity = detectSuspiciousActivity(
      user.id,
      event.requestContext.identity.sourceIp,
      event.requestContext.identity.userAgent,
      event.resource
    );

    if (suspiciousActivity.isSuspicious && suspiciousActivity.risk === 'HIGH') {
      logSecurityEvent({
        eventType: 'SUSPICIOUS_ACTIVITY',
        userId: user.id,
        ipAddress: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
        resource: event.resource,
        details: `High risk activity detected: ${suspiciousActivity.reason}`,
        timestamp: new Date(),
      });

      // For high-risk activity, deny access
      return createUnauthorizedResponse(
        event.methodArn,
        'SUSPICIOUS_ACTIVITY',
        'Access denied due to suspicious activity'
      );
    }

    // Log admin access for auditing
    if (user.isAdmin) {
      logSecurityEvent({
        eventType: 'ADMIN_ACCESS',
        userId: user.id,
        ipAddress: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
        resource: event.resource,
        details: 'Admin user accessed protected resource',
        timestamp: new Date(),
      });
    }

    // Create authorized response
    const context: AuthorizerContext = {
      userId: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin.toString(),
      isAwsEmployee: user.isAwsEmployee.toString(),
      badges: JSON.stringify(enrichedContext.badges || []),
    };

    // Add rate limit info if available
    if (enrichedContext.rateLimitInfo) {
      context.rateLimitRemaining = enrichedContext.rateLimitInfo.remainingRequests.toString();
    }

    console.log('User authorized:', {
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      resource: event.resource,
    });

    return {
      principalId: user.id,
      policyDocument: generatePolicyDocument('Allow', event.methodArn),
      context,
    };

  } catch (error: any) {
    console.error('Authorizer error:', error);

    logSecurityEvent({
      eventType: 'AUTHENTICATION_FAILED',
      resource: event.methodArn,
      details: `Unexpected error: ${error.message}`,
      timestamp: new Date(),
    });

    return createUnauthorizedResponse(
      event.methodArn,
      'AUTHORIZATION_ERROR',
      'Internal authorization error'
    );
  }
}

/**
 * Lambda handler for token refresh
 */
export interface TokenRefreshEvent {
  refreshToken: string;
  clientId: string;
}

export async function refreshTokenHandler(event: TokenRefreshEvent) {
  try {
    const { handleTokenRefresh } = await import('./tokenVerifier');
    return await handleTokenRefresh(event);
  } catch (error: any) {
    console.error('Token refresh error:', error);
    return {
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: 'Failed to refresh token',
        details: error.message,
      },
    };
  }
}

/**
 * Health check handler
 */
export async function healthCheckHandler() {
  try {
    const { healthCheck } = await import('./utils');
    return healthCheck();
  } catch (error: any) {
    return {
      status: 'unhealthy',
      details: {
        error: error.message,
        timestamp: Date.now(),
      },
    };
  }
}

/**
 * Cleanup handler for graceful shutdown
 */
export async function cleanup() {
  try {
    if (dbPool) {
      await dbPool.end();
      dbPool = null;
    }
    console.log('Authorizer cleanup completed');
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Lambda lifecycle handlers
process.on('beforeExit', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);