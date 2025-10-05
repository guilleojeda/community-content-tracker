import { UserRepository } from '../../repositories/UserRepository';
import { BadgeType, RegisterRequest, LoginRequest, RefreshTokenRequest, VerifyEmailRequest } from '../../../shared/types';

/**
 * Rate limiting information
 */
export interface RateLimitInfo {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
}

/**
 * User badge information
 */
export interface UserBadge {
  badgeType: BadgeType;
  earnedAt: Date;
}

/**
 * Rate limit store interface
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store (in production, use Redis or DynamoDB)
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Extract JWT token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] || null;
}

/**
 * Check if endpoint requires admin privileges
 */
export function isAdminOnlyEndpoint(resource: string): boolean {
  const adminEndpoints = [
    '/admin/',
    '/admin/users',
    '/admin/content',
    '/admin/badges',
    '/admin/reports',
    '/admin/analytics',
    '/admin/system',
  ];

  return adminEndpoints.some(endpoint => resource.startsWith(endpoint));
}

/**
 * Check rate limit for user
 */
export async function checkRateLimit(
  userId: string,
  limitPerHour: number = 1000
): Promise<RateLimitInfo> {
  try {
    const now = Date.now();
    const resetTime = now + (60 * 60 * 1000); // 1 hour from now
    const key = `ratelimit:${userId}`;

    // Get current rate limit entry
    let entry = rateLimitStore.get(key);

    // Reset if expired
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 0,
        resetTime,
      };
    }

    // Increment counter
    entry.count += 1;

    // Check if limit exceeded
    if (entry.count > limitPerHour) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: entry.resetTime,
      };
    }

    // Update store
    rateLimitStore.set(key, entry);

    // Clean up expired entries periodically
    if (rateLimitStore.size > 10000) {
      for (const [storeKey, storeEntry] of rateLimitStore.entries()) {
        if (storeEntry.resetTime <= now) {
          rateLimitStore.delete(storeKey);
        }
      }
    }

    return {
      allowed: true,
      remainingRequests: limitPerHour - entry.count,
      resetTime: entry.resetTime,
    };

  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Fail open - allow request if rate limiting fails
    return {
      allowed: true,
      remainingRequests: 1000,
      resetTime: Date.now() + (60 * 60 * 1000),
    };
  }
}

/**
 * Get user badges from database
 */
export async function getUserBadges(
  userId: string,
  userRepository: UserRepository
): Promise<UserBadge[]> {
  try {
    // In a real implementation, this would query a user_badges table
    // For now, we'll simulate with a direct query
    const query = `
      SELECT
        ub.badge_type,
        ub.earned_at
      FROM user_badges ub
      WHERE ub.user_id = $1
      ORDER BY ub.earned_at DESC
    `;

    const result = await (userRepository as any).executeQuery(query, [userId]);

    return result.rows.map((row: any) => ({
      badgeType: row.badge_type as BadgeType,
      earnedAt: new Date(row.earned_at),
    }));

  } catch (error) {
    console.error('Failed to retrieve user badges:', error);
    // Return empty array if badges can't be retrieved
    return [];
  }
}

/**
 * Validate admin privileges for specific operations
 */
export interface AdminPrivilegeCheck {
  isValid: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export async function validateAdminPrivileges(
  userId: string,
  operation: string,
  userRepository: UserRepository
): Promise<AdminPrivilegeCheck> {
  try {
    const isAdmin = await userRepository.isAdmin(userId);

    if (!isAdmin) {
      return {
        isValid: false,
        error: {
          code: 'INSUFFICIENT_PRIVILEGES',
          message: `Admin privileges required for operation: ${operation}`,
        },
      };
    }

    return { isValid: true };

  } catch (error) {
    console.error('Admin privilege validation failed:', error);
    return {
      isValid: false,
      error: {
        code: 'PRIVILEGE_CHECK_FAILED',
        message: 'Failed to validate admin privileges',
      },
    };
  }
}

/**
 * Generate AWS API Gateway policy document
 */
export interface PolicyStatement {
  Action: string;
  Effect: 'Allow' | 'Deny';
  Resource: string;
}

export interface PolicyDocument {
  Version: string;
  Statement: PolicyStatement[];
}

export function generatePolicyDocument(
  effect: 'Allow' | 'Deny',
  methodArn: string
): PolicyDocument {
  // Extract the base ARN for wildcard resource
  const arnParts = methodArn.split(':');
  const apiGatewayArnParts = methodArn.split('/');

  // Build wildcard resource ARN
  let resource = methodArn;
  if (apiGatewayArnParts.length >= 4) {
    const baseArn = apiGatewayArnParts.slice(0, 3).join('/');
    resource = `${baseArn}/*/*`;
  }

  return {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };
}

/**
 * Sanitize and validate method ARN
 */
export function validateMethodArn(methodArn: string): boolean {
  if (!methodArn) {
    return false;
  }

  // Basic ARN validation for API Gateway
  const arnPattern = /^arn:aws:execute-api:[a-z0-9-]+:\d{12}:[a-zA-Z0-9]+\/[a-zA-Z0-9]+\/[A-Z]+\/.*$/;
  return arnPattern.test(methodArn);
}

/**
 * Extract API Gateway information from method ARN
 */
export interface ApiGatewayInfo {
  region: string;
  accountId: string;
  apiId: string;
  stage: string;
  method: string;
  resource: string;
}

export function parseMethodArn(methodArn: string): ApiGatewayInfo | null {
  try {
    const parts = methodArn.split(':');
    if (parts.length < 6) {
      return null;
    }

    const pathParts = parts[5].split('/');
    if (pathParts.length < 4) {
      return null;
    }

    return {
      region: parts[3],
      accountId: parts[4],
      apiId: pathParts[0],
      stage: pathParts[1],
      method: pathParts[2],
      resource: '/' + pathParts.slice(3).join('/'),
    };

  } catch (error) {
    console.error('Failed to parse method ARN:', error);
    return null;
  }
}

/**
 * Get user's content access level based on visibility and user status
 */
export interface ContentAccessLevel {
  canViewPrivate: boolean;
  canViewAwsOnly: boolean;
  canViewAwsCommunity: boolean;
  canViewPublic: boolean;
  canModerate: boolean;
}

export function getContentAccessLevel(
  isAdmin: boolean,
  isAwsEmployee: boolean,
  isOwner: boolean = false
): ContentAccessLevel {
  return {
    canViewPrivate: isOwner || isAdmin,
    canViewAwsOnly: isAwsEmployee || isAdmin,
    canViewAwsCommunity: true, // All authenticated users
    canViewPublic: true, // All users
    canModerate: isAdmin,
  };
}

/**
 * Validate content visibility permissions
 */
export function canAccessContent(
  contentVisibility: string,
  userAccessLevel: ContentAccessLevel
): boolean {
  switch (contentVisibility) {
    case 'private':
      return userAccessLevel.canViewPrivate;
    case 'aws_only':
      return userAccessLevel.canViewAwsOnly;
    case 'aws_community':
      return userAccessLevel.canViewAwsCommunity;
    case 'public':
      return userAccessLevel.canViewPublic;
    default:
      return false;
  }
}

/**
 * Log security events for monitoring
 */
export interface SecurityEvent {
  eventType: 'AUTHENTICATION_FAILED' | 'RATE_LIMIT_EXCEEDED' | 'UNAUTHORIZED_ACCESS' |
             'ADMIN_ACCESS' | 'TOKEN_EXPIRED' | 'SUSPICIOUS_ACTIVITY';
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  details?: string;
  timestamp: Date;
}

export function logSecurityEvent(event: SecurityEvent): void {
  try {
    // In production, send to CloudWatch, Kinesis, or security monitoring system
    console.log('SECURITY_EVENT:', JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    }));

    // Could also send to AWS CloudWatch Events, SNS, or SQS for real-time alerting

  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Detect suspicious activity patterns
 */
export interface SuspiciousActivityCheck {
  isSuspicious: boolean;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  reason?: string;
}

export function detectSuspiciousActivity(
  userId: string,
  ipAddress: string,
  userAgent: string,
  resource: string
): SuspiciousActivityCheck {
  const checks = [];

  // Check for admin endpoint access by non-admin
  if (isAdminOnlyEndpoint(resource)) {
    checks.push('admin_endpoint_access');
  }

  // Check for unusual user agent
  if (!userAgent || userAgent.length < 10) {
    checks.push('suspicious_user_agent');
  }

  // Check for potential automated requests
  if (userAgent.toLowerCase().includes('bot') ||
      userAgent.toLowerCase().includes('crawler') ||
      userAgent.toLowerCase().includes('spider')) {
    checks.push('automated_request');
  }

  // Determine risk level
  let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (checks.length >= 3) {
    risk = 'HIGH';
  } else if (checks.length >= 2) {
    risk = 'MEDIUM';
  }

  return {
    isSuspicious: checks.length > 0,
    risk,
    reason: checks.length > 0 ? checks.join(', ') : undefined,
  };
}

/**
 * Clear rate limit store (useful for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: Record<string, string>;
}

/**
 * Validate registration input
 */
export function validateRegistrationInput(input: RegisterRequest): ValidationResult {
  const errors: Record<string, string> = {};

  // Email validation
  if (!input.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Invalid email format';
  }

  // Password validation
  if (!input.password) {
    errors.password = 'Password is required';
  } else if (input.password.length < 12) {
    errors.password = 'Password must be at least 12 characters';
  } else if (!isStrongPassword(input.password)) {
    errors.password = 'Password must contain uppercase, lowercase, number, and special character';
  }

  // Username validation
  if (!input.username) {
    errors.username = 'Username is required';
  } else if (!isValidUsername(input.username)) {
    errors.username = 'Username can only contain letters, numbers, and underscores';
  } else if (input.username.length < 3 || input.username.length > 30) {
    errors.username = 'Username must be between 3 and 30 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Validate login input
 */
export function validateLoginInput(input: LoginRequest): ValidationResult {
  const errors: Record<string, string> = {};

  // Email validation
  if (!input.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Invalid email format';
  }

  // Password validation
  if (!input.password) {
    errors.password = 'Password is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Validate refresh token input
 */
export function validateRefreshTokenInput(input: RefreshTokenRequest): ValidationResult {
  const errors: Record<string, string> = {};

  // Refresh token validation
  if (!input.refreshToken) {
    errors.refreshToken = 'Refresh token is required';
  } else if (input.refreshToken.trim() === '') {
    errors.refreshToken = 'Refresh token cannot be empty';
  } else if (!isValidJwtFormat(input.refreshToken)) {
    errors.refreshToken = 'Invalid refresh token format';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Validate email verification input
 */
export function validateVerifyEmailInput(input: VerifyEmailRequest): ValidationResult {
  const errors: Record<string, string> = {};

  // Email validation
  if (!input.email) {
    errors.email = 'Email is required';
  } else if (!isValidEmail(input.email)) {
    errors.email = 'Invalid email format';
  }

  // Confirmation code validation
  if (!input.confirmationCode) {
    errors.code = 'Confirmation code is required';
  } else if (input.confirmationCode.length !== 6) {
    errors.code = 'Confirmation code must be 6 digits';
  } else if (!/^\d{6}$/.test(input.confirmationCode)) {
    errors.code = 'Confirmation code must contain only numbers';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Check if email format is valid
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if password is strong enough
 */
export function isStrongPassword(password: string): boolean {
  // At least 12 characters, contains uppercase, lowercase, number, and special character
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
}

/**
 * Check if username format is valid
 */
export function isValidUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username);
}

/**
 * Check if token has JWT-like format
 */
export function isValidJwtFormat(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3;
}

/**
 * Check if email belongs to AWS employee
 */
export function isAwsEmployee(email: string): boolean {
  const awsDomains = [
    '@amazon.com',
    '@aws.amazon.com',
    '@amazon.co.uk',
    '@amazon.de',
    '@amazon.fr',
    '@amazon.es',
    '@amazon.it',
    '@amazon.ca',
    '@amazon.com.au',
    '@amazon.co.jp',
    '@amazon.in',
    '@amazon.com.br',
    '@amazon.com.mx',
    '@audible.com',
    '@wholefoodsmarket.com',
    '@twitch.tv',
  ];

  const lowerEmail = email.toLowerCase();
  return awsDomains.some(domain => lowerEmail.endsWith(domain));
}

/**
 * Generate a unique profile slug from username
 */
export function generateProfileSlug(username: string, existingSlugs: string[] = []): string {
  let baseSlug = username.toLowerCase().replace(/[^a-z0-9]/g, '-');

  // Remove consecutive dashes and trim
  baseSlug = baseSlug.replace(/-+/g, '-').replace(/^-|-$/g, '');

  let slug = baseSlug;
  let counter = 2;

  // Keep appending numbers until we find a unique slug
  while (existingSlugs.includes(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Create standardized CORS headers
 */
export function createCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  statusCode: number,
  errorCode: string,
  message: string,
  details?: Record<string, any>
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: createCorsHeaders(),
    body: JSON.stringify({
      error: {
        code: errorCode,
        message,
        ...(details && { details }),
      },
    }),
  };
}

/**
 * Create standardized success response
 */
export function createSuccessResponse(
  statusCode: number = 200,
  data: Record<string, any>
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: createCorsHeaders(),
    body: JSON.stringify(data),
  };
}

/**
 * Parse and validate request body
 */
export function parseRequestBody<T>(body: string | null): { data?: T; error?: any } {
  if (!body) {
    return {
      error: createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Request body is required'
      ),
    };
  }

  try {
    const data = JSON.parse(body) as T;
    return { data };
  } catch (error) {
    return {
      error: createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid JSON in request body'
      ),
    };
  }
}

/**
 * Parse and validate query parameters
 */
export function parseQueryParams(queryStringParameters: Record<string, string> | null): {
  email?: string;
  code?: string;
  error?: any;
} {
  if (!queryStringParameters) {
    return {
      error: createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Query parameters are required'
      ),
    };
  }

  // Decode and trim parameters
  const email = queryStringParameters.email ? decodeURIComponent(queryStringParameters.email).trim() : undefined;
  const code = queryStringParameters.code ? decodeURIComponent(queryStringParameters.code).trim() : undefined;

  return { email, code };
}

/**
 * Map Cognito error to standardized error response
 */
export function mapCognitoError(error: any): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  console.error('Cognito error:', error);

  switch (error.name) {
    case 'UsernameExistsException':
      return createErrorResponse(
        409,
        'DUPLICATE_RESOURCE',
        'Username already exists'
      );

    case 'InvalidParameterException':
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid parameters provided'
      );

    case 'InvalidPasswordException':
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Password does not meet requirements'
      );

    case 'NotAuthorizedException':
      if (error.message?.includes('confirmed')) {
        return createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'User account is already confirmed'
        );
      }
      return createErrorResponse(
        401,
        'AUTH_INVALID',
        'Invalid credentials or refresh token is expired or invalid'
      );

    case 'UserNotFoundException':
      return createErrorResponse(
        404,
        'NOT_FOUND',
        'User not found'
      );

    case 'UserNotConfirmedException':
      return createErrorResponse(
        401,
        'AUTH_INVALID',
        'User account not confirmed. Please verify your email address.'
      );

    case 'UserTemporarilyLockedException':
      return createErrorResponse(
        401,
        'AUTH_INVALID',
        'User account is temporarily locked due to too many failed login attempts'
      );

    case 'CodeMismatchException':
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Invalid or expired confirmation code'
      );

    case 'ExpiredCodeException':
      return createErrorResponse(
        400,
        'VALIDATION_ERROR',
        'Confirmation code has expired. Please request a new one.'
      );

    case 'TooManyRequestsException':
      return createErrorResponse(
        429,
        'RATE_LIMITED',
        'Too many requests. Please try again later.'
      );

    case 'InternalErrorException':
    default:
      return createErrorResponse(
        500,
        'INTERNAL_ERROR',
        'An unexpected error occurred'
      );
  }
}

/**
 * Health check for auth utilities
 */
export function healthCheck(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: any } {
  try {
    const now = Date.now();

    return {
      status: 'healthy',
      details: {
        rateLimitStoreSize: rateLimitStore.size,
        timestamp: now,
        version: '1.0.0',
      },
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
    };
  }
}