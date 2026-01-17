import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { BadgeType } from '@aws-community-hub/shared';
import { BadgeRepository } from '../../repositories/BadgeRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AuditLogService } from '../../services/AuditLogService';
import { NotificationService } from '../../services/NotificationService';
import { getDatabasePool } from '../../services/database';
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from '../auth/utils';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

interface BadgeGrantRequest {
  userId?: string;
  userIds?: string[];
  badgeType: BadgeType | string;
  reason?: string;
  metadata?: Record<string, any>;
}

interface BadgeRevokeRequest {
  userId?: string;
  badgeType?: BadgeType | string;
  reason?: string;
}

interface AwsEmployeeRequest {
  isAwsEmployee?: boolean;
  verificationMethod?: 'email-domain' | 'manual' | string;
  metadata?: Record<string, any>;
  reason?: string;
}

interface BulkBadgeRequest {
  operation: 'grant' | 'revoke';
  userIds?: string[];
  badgeType?: BadgeType | string;
  reason?: string;
}

type LambdaDeps = {
  badgeRepository: BadgeRepository;
  userRepository: UserRepository;
  auditLogService: AuditLogService;
  notificationService: NotificationService;
};

let cachedDeps: LambdaDeps | null = null;
let dependencyOverrides: Partial<LambdaDeps> | null = null;

function getLatestMockInstance<T>(ctor: any): T | undefined {
  const mockInstances = ctor?.mock?.instances;
  if (Array.isArray(mockInstances) && mockInstances.length > 0) {
    return mockInstances[mockInstances.length - 1] as T;
  }
  return undefined;
}

export function __setBadgeDependenciesForTest(overrides: Partial<LambdaDeps> | null): void {
  dependencyOverrides = overrides;
  cachedDeps = null;
}

async function getDependencies(): Promise<LambdaDeps> {
  if (cachedDeps) {
    return cachedDeps;
  }

  const badgeOverride =
    dependencyOverrides?.badgeRepository ?? getLatestMockInstance<BadgeRepository>(BadgeRepository as any);
  const userOverride =
    dependencyOverrides?.userRepository ?? getLatestMockInstance<UserRepository>(UserRepository as any);
  const auditOverride =
    dependencyOverrides?.auditLogService ?? getLatestMockInstance<AuditLogService>(AuditLogService as any);
  const notificationOverride =
    dependencyOverrides?.notificationService ?? getLatestMockInstance<NotificationService>(NotificationService as any);

  const needsPool = !badgeOverride || !userOverride || !auditOverride || !notificationOverride;
  const pool = needsPool ? await getDatabasePool() : null;

  const resolved: LambdaDeps = {
    badgeRepository: badgeOverride ?? new BadgeRepository(pool!),
    userRepository: userOverride ?? new UserRepository(pool!),
    auditLogService: auditOverride ?? new AuditLogService(pool!),
    notificationService: notificationOverride ?? new NotificationService(pool!),
  };

  cachedDeps = resolved;

  return resolved;
}

function extractAdminContext(event: APIGatewayProxyEvent) {
  const authorizer: any = event.requestContext?.authorizer || {};
  const claims: any = authorizer.claims || {};

  const isAdminFlag =
    authorizer.isAdmin === true ||
    authorizer.isAdmin === 'true' ||
    (Array.isArray(claims['cognito:groups'])
      ? claims['cognito:groups'].includes('Admin')
      : typeof claims['cognito:groups'] === 'string'
      ? claims['cognito:groups'].split(',').includes('Admin')
      : false);

  const adminUserId = authorizer.userId || claims.sub || claims['cognito:username'];

  return {
    isAdmin: !!isAdminFlag,
    adminUserId,
  };
}

function normalizeBadgeType(badgeType: string | BadgeType): BadgeType | null {
  if (!badgeType) {
    return null;
  }

  const normalized = String(badgeType).toLowerCase() as BadgeType;
  return Object.values(BadgeType).includes(normalized) ? normalized : null;
}

async function handleGrantBadge(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const { data: body, error } = parseRequestBody<BadgeGrantRequest>(event.body);
  if (error) {
    return error;
  }

  if (!body) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
  }

  const badgeType = normalizeBadgeType(body.badgeType);
  if (!badgeType) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      `Invalid badge type. Must be one of: ${Object.values(BadgeType).join(', ')}`
    );
  }

  const targetUserIds =
    (Array.isArray(body.userIds) && body.userIds.length > 0 && body.userIds) ||
    (body.userId ? [body.userId] : []);

  if (targetUserIds.length === 0) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'userId or userIds is required');
  }

  const { badgeRepository, userRepository, auditLogService, notificationService } = deps;
  const results: Array<{
    success: boolean;
    userId: string;
    badgeType: BadgeType;
    message?: string;
  }> = [];

  for (const userId of targetUserIds) {
    try {
      const user = await userRepository.findById(userId);
      if (!user) {
        results.push({
          success: false,
          userId,
          badgeType,
          message: 'User not found',
        });
        continue;
      }

      const alreadyHasBadge = await badgeRepository.userHasBadge(userId, badgeType);
      if (alreadyHasBadge) {
        results.push({
          success: false,
          userId,
          badgeType,
          message: 'User already has this badge',
        });
        continue;
      }

      const grantedBadge = await badgeRepository.grantBadge({
        userId,
        badgeType,
        awardedBy: admin.adminUserId ?? undefined,
        awardedReason: body.reason,
        metadata: body.metadata ?? {},
      });

      await auditLogService.logBadgeGrant(
        admin.adminUserId ?? 'unknown',
        userId,
        badgeType,
        body.reason,
        body.metadata
      );

      await notificationService.notifyBadgeGranted(userId, badgeType, body.reason);

      results.push({
        success: true,
        userId,
        badgeType,
      });

      // For single grant we can return immediately
      if (targetUserIds.length === 1) {
        return createSuccessResponse(201, {
          success: true,
          data: {
            ...grantedBadge,
            badge_type: badgeType,
            metadata: body.metadata ?? {},
            reason: body.reason,
          },
        });
      }
    } catch (err) {
      console.error('Failed to grant badge', { userId, badgeType, err });
      results.push({
        success: false,
        userId,
        badgeType,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return createSuccessResponse(200, {
    success: true,
    data: {
      successful: results.filter((r) => r.success).map((r) => r.userId),
      failed: results.filter((r) => !r.success).map((r) => ({
        userId: r.userId,
        reason: r.message ?? 'Failed to grant badge',
      })),
      badgeType,
    },
  });
}

async function handleBulkOperation(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const { data: body, error } = parseRequestBody<BulkBadgeRequest>(event.body);
  if (error) {
    return error;
  }

  if (!body) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
  }

  const { badgeRepository } = deps;

  const userIds = Array.isArray(body.userIds) ? body.userIds : [];
  if (!body.operation || userIds.length === 0) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'operation and userIds are required for bulk badge operations'
    );
  }

  const badgeType = normalizeBadgeType(body.badgeType as BadgeType);
  if (!badgeType) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'badgeType is required for bulk operations');
  }

  if (body.operation === 'grant') {
    const repoResult = await badgeRepository.bulkGrantBadges(
      userIds.map((userId) => ({
        userId,
        badgeType,
        awardedBy: admin.adminUserId ?? undefined,
        awardedReason: body.reason,
      }))
    );

    const responseData = Array.isArray(repoResult)
      ? {
          successful: repoResult.map((badge) => badge.userId),
          failed: userIds.filter(
            (userId) => !repoResult.find((badge) => badge.userId === userId)
          ),
        }
      : repoResult;

    return createSuccessResponse(200, {
      success: true,
      data: responseData,
    });
  }

  if (body.operation === 'revoke') {
    const failed: Array<{ userId: string; reason: string }> = [];
    const successful: string[] = [];

    for (const userId of userIds) {
      const revoked = await badgeRepository.revokeBadge(userId, badgeType);
      if (revoked) {
        successful.push(userId);
      } else {
        failed.push({ userId, reason: 'Badge not found' });
      }
    }

    return createSuccessResponse(200, {
      success: true,
      data: {
        successful,
        failed,
      },
    });
  }

  return createErrorResponse(400, 'VALIDATION_ERROR', `Unsupported bulk operation: ${body.operation}`);
}

async function handleRevokeBadge(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const { data: body, error } = parseRequestBody<BadgeRevokeRequest>(event.body);
  if (error) {
    return error;
  }

  if (!body) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Request body is required');
  }

  const badgeType = normalizeBadgeType(body.badgeType as BadgeType);
  if (!badgeType || !body.userId) {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'userId and badgeType are required for badge revocation'
    );
  }

  if (!body.reason) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'Reason is required for badge revocation');
  }

  const { badgeRepository, auditLogService } = deps;

  const revoked = await badgeRepository.revokeBadge(body.userId, badgeType);
  if (!revoked) {
    return createErrorResponse(404, 'NOT_FOUND', 'Badge not found');
  }

  await auditLogService.logBadgeRevoke(
    admin.adminUserId ?? 'unknown',
    body.userId,
    badgeType,
    body.reason
  );

  return createSuccessResponse(200, {
    success: true,
    data: {
      userId: body.userId,
      badgeType,
      revokedAt: new Date().toISOString(),
    },
  });
}

async function handleAwsEmployeeStatus(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const userId = event.pathParameters?.id;
  if (!userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID parameter is required');
  }

  const { data: body, error } = parseRequestBody<AwsEmployeeRequest>(event.body);
  if (error) {
    return error;
  }

  if (!body || typeof body.isAwsEmployee !== 'boolean') {
    return createErrorResponse(
      400,
      'VALIDATION_ERROR',
      'isAwsEmployee flag is required to update employee status'
    );
  }

  const { userRepository, auditLogService } = deps;
  const user = await userRepository.findById(userId);

  if (!user) {
    return createErrorResponse(404, 'NOT_FOUND', 'User not found');
  }

  if (body.isAwsEmployee && body.verificationMethod === 'email-domain') {
    if (!user.email || !user.email.toLowerCase().endsWith('@amazon.com')) {
      return createErrorResponse(400, 'VALIDATION_ERROR', 'Email domain does not match AWS');
    }
  }

  const updatedUser = await userRepository.updateAwsEmployeeStatus(userId, body.isAwsEmployee);
  await auditLogService.logAwsEmployeeChange(
    admin.adminUserId ?? 'unknown',
    userId,
    body.isAwsEmployee,
    body.reason,
    body.metadata
  );

  return createSuccessResponse(200, {
    success: true,
    data: {
      ...(updatedUser ?? { id: userId }),
      is_aws_employee: body.isAwsEmployee,
    },
  });
}

async function handlePublicBadgeListing(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const userId = event.pathParameters?.id ?? event.pathParameters?.userId;
  if (!userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'User ID parameter is required');
  }

  const { badgeRepository } = deps;
  const badges = await badgeRepository.findByUserId(userId);

  const activeBadges = (badges as any[]).filter((badge) => badge.is_active !== false);

  return createSuccessResponse(200, {
    success: true,
    data: activeBadges,
  });
}

async function handleBadgeHistory(
  event: APIGatewayProxyEvent,
  deps: LambdaDeps
): Promise<APIGatewayProxyResult> {
  const admin = extractAdminContext(event);
  if (!admin.isAdmin) {
    return createErrorResponse(403, 'PERMISSION_DENIED', 'Admin privileges required');
  }

  const userId = event.pathParameters?.userId;
  if (!userId) {
    return createErrorResponse(400, 'VALIDATION_ERROR', 'userId parameter is required');
  }

  const { badgeRepository } = deps;
  const history = await badgeRepository.getBadgeHistory(userId);

  return createSuccessResponse(200, {
    success: true,
    data: history,
  });
}

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const deps = await getDependencies();
  const path = event.path || '';
  const method = (event.httpMethod || 'GET').toUpperCase();
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    rateLimit = await applyRateLimit(event, { resource: 'admin:badges' });
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));
    }

    if (method === 'POST' && path === '/admin/badges/bulk') {
      return withRateLimit(await handleBulkOperation(event, deps));
    }

    if (method === 'POST' && path === '/admin/badges') {
      return withRateLimit(await handleGrantBadge(event, deps));
    }

    if (method === 'DELETE' && path === '/admin/badges') {
      return withRateLimit(await handleRevokeBadge(event, deps));
    }

    if (method === 'PUT' && /^\/admin\/users\/[^/]+\/aws-employee$/.test(path)) {
      return withRateLimit(await handleAwsEmployeeStatus(event, deps));
    }

    if (method === 'GET' && /^\/users\/[^/]+\/badges$/.test(path)) {
      return withRateLimit(await handlePublicBadgeListing(event, deps));
    }

    if (method === 'GET' && /^\/admin\/badges\/history\/[^/]+$/.test(path)) {
      return withRateLimit(await handleBadgeHistory(event, deps));
    }

    return withRateLimit(createErrorResponse(404, 'NOT_FOUND', `Route not found: ${method} ${path}`));
  } catch (error) {
    console.error('Unhandled badge admin error', { path, method, error });
    return attachRateLimitHeaders(
      createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
      rateLimit
    );
  }
}
