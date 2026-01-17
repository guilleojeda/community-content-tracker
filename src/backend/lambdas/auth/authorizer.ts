import { UserRepository } from '../../repositories/UserRepository';
import { verifyJwtToken, TokenVerifierConfig } from './tokenVerifier';
import {
  extractTokenFromHeader,
  isAdminOnlyEndpoint,
  checkRateLimit,
  getUserBadges,
  generatePolicyDocument,
  validateMethodArn,
  logSecurityEvent,
  detectSuspiciousActivity,
  PolicyDocument,
  RateLimitInfo,
  UserBadge
} from './utils';
import { getDatabasePool } from '../../services/database';
import { getAuthEnvironment } from './config';
import type { Pool } from 'pg';

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
  rateLimitPerMinute: number;
  tokenVerificationTimeoutMs: number;
}

let dbPool: Pool | null = null;

/**
 * Load configuration from environment variables
 */
function loadConfig(): AuthorizerConfig {
  const authEnv = getAuthEnvironment();
  const allowedAudiences =
    authEnv.allowedAudiences.length > 0 ? authEnv.allowedAudiences : [authEnv.clientId];
  const rateLimitRaw = process.env.AUTH_RATE_LIMIT_PER_MINUTE;
  if (!rateLimitRaw || rateLimitRaw.trim().length === 0) {
    throw new Error('AUTH_RATE_LIMIT_PER_MINUTE must be set');
  }
  const rateLimitPerMinute = parseInt(rateLimitRaw, 10);
  if (Number.isNaN(rateLimitPerMinute)) {
    throw new Error('AUTH_RATE_LIMIT_PER_MINUTE must be a valid number');
  }

  return {
    cognitoUserPoolId: authEnv.userPoolId,
    cognitoRegion: authEnv.region,
    allowedAudiences,
    issuer: `https://cognito-idp.${authEnv.region}.amazonaws.com/${authEnv.userPoolId}`,
    rateLimitPerMinute,
    tokenVerificationTimeoutMs: authEnv.tokenVerificationTimeoutMs,
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
    const rateLimitInfo = await checkRateLimit(userId, config.rateLimitPerMinute, 60_000);

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
    const methodArnValid = validateMethodArn(event.methodArn);
    if (!methodArnValid) {
      return createUnauthorizedResponse(
        event.methodArn,
        'INTERNAL_ERROR',
        'Invalid method ARN format'
      );
    }

    // Basic environment validation before loading config
    if (!process.env.COGNITO_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID.trim() === '') {
      return createUnauthorizedResponse(
        event.methodArn,
        'INTERNAL_ERROR',
        'Missing required environment variables: COGNITO_USER_POOL_ID'
      );
    }

    // Load configuration
    let config: AuthorizerConfig;
    try {
      config = loadConfig();
    } catch (configError: any) {
      return createUnauthorizedResponse(
        event.methodArn,
        'INTERNAL_ERROR',
        configError.message
      );
    }

    // Extract token from Authorization header
    const token = extractTokenFromHeader(event.headers.Authorization);
    if (!token) {
      return createUnauthorizedResponse(
        event.methodArn,
        'AUTH_REQUIRED',
        'Authorization header missing or malformed'
      );
    }

    // Setup database connection
    const pool = await getDatabasePool();
    dbPool = pool;
    const userRepository = new UserRepository(pool);

    // Verify JWT token
    const tokenConfig: TokenVerifierConfig = {
      cognitoUserPoolId: config.cognitoUserPoolId,
      cognitoRegion: config.cognitoRegion,
      allowedAudiences: config.allowedAudiences,
      issuer: config.issuer,
    };

    const tokenResult = await Promise.race([
      verifyJwtToken(token, tokenConfig, userRepository),
      new Promise<Awaited<ReturnType<typeof verifyJwtToken>>>((resolve) => {
        setTimeout(() => {
          resolve({
            isValid: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Authorization timeout',
              details: 'Request took too long',
            },
          } as any);
        }, config.tokenVerificationTimeoutMs);
      }),
    ]);

    if (!tokenResult.isValid || !tokenResult.user) {
      return createUnauthorizedResponse(
        event.methodArn,
        tokenResult.error?.code || 'AUTH_INVALID',
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
        eventType: 'RATE_LIMITED',
        userId: user.id,
        ipAddress: event.requestContext.identity.sourceIp,
        userAgent: event.requestContext.identity.userAgent,
        resource: event.resource,
        details: `Rate limit exceeded: ${config.rateLimitPerMinute} requests per minute`,
        timestamp: new Date(),
      });

      const rateLimitResponse = createUnauthorizedResponse(
        event.methodArn,
        'RATE_LIMITED',
        'Too many requests'
      );
      rateLimitResponse.context.rateLimitRemaining = enrichedContext.rateLimitInfo.remainingRequests.toString();
      return rateLimitResponse;
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
        'PERMISSION_DENIED',
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
      'INTERNAL_ERROR',
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
        code: 'INTERNAL_ERROR',
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
