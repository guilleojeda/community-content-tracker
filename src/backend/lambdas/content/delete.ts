import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getDatabasePool } from '../../services/database';
import { ContentRepository } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { buildCorsHeaders } from '../../services/cors';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';

interface AuthorizerPayload {
  userId?: string;
  isAdmin?: boolean | string;
  claims?: Record<string, any>;
  groups?: string[] | string;
}

function parseGroups(rawGroups: unknown): string[] {
  if (!rawGroups) {
    return [];
  }

  if (Array.isArray(rawGroups)) {
    return rawGroups as string[];
  }

  if (typeof rawGroups === 'string') {
    try {
      const parsed = JSON.parse(rawGroups);
      return Array.isArray(parsed) ? parsed : rawGroups.split(',');
    } catch {
      return rawGroups.split(',');
    }
  }

  return [];
}

function extractUserContext(authorizer: AuthorizerPayload | undefined) {
  if (!authorizer) {
    return { userId: undefined, isAdmin: false };
  }

  const claims = authorizer.claims ?? {};
  const userId = authorizer.userId
    ?? claims.sub
    ?? claims['cognito:username']
    ?? claims.username;

  const groups = parseGroups(claims['cognito:groups'] ?? authorizer.groups);
  const adminFlag = authorizer.isAdmin;
  const isAdmin = adminFlag === true
    || adminFlag === 'true'
    || groups.some(group => group?.toLowerCase() === 'admins' || group?.toLowerCase() === 'admin');

  return { userId, isAdmin };
}

function responseHeaders(origin?: string | null) {
  return {
    ...buildCorsHeaders({ origin, methods: 'OPTIONS,DELETE', allowCredentials: true }),
    'Content-Type': 'application/json',
  };
}

function errorResponse(statusCode: number, code: string, message: string, origin?: string | null) {
  return {
    statusCode,
    headers: responseHeaders(origin),
    body: JSON.stringify({
      error: {
        code,
        message,
      },
    }),
  };
}

export async function handler(
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> {
  console.log('Delete content request:', JSON.stringify(event, null, 2));
  let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const respondError = (statusCode: number, code: string, message: string) =>
      attachRateLimitHeaders(errorResponse(statusCode, code, message, originHeader), rateLimit);

    rateLimit = await applyRateLimit(event, { resource: 'content:delete' });
    if (rateLimit && !rateLimit.allowed) {
      return respondError(429, 'RATE_LIMITED', 'Too many requests');
    }

    const { userId, isAdmin } = extractUserContext(event.requestContext.authorizer as AuthorizerPayload);

    if (!userId) {
      return respondError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    const contentId = event.pathParameters?.id;
    if (!contentId) {
      return respondError(400, 'VALIDATION_ERROR', 'Content ID is required');
    }

    // Get database pool and repositories
    const dbPool = await getDatabasePool();
    const contentRepository = new ContentRepository(dbPool);
    const userRepository = new UserRepository(dbPool);

    // Verify user exists and get their admin status from database
    const user = await userRepository.findById(userId);
    if (!user) {
      return respondError(401, 'AUTH_INVALID', 'User not found');
    }

    // Combine authorizer admin flag with database admin flag
    const isUserAdmin = isAdmin || user.isAdmin;

    // Get the content
    const content = await contentRepository.findById(contentId);

    if (!content) {
      return respondError(404, 'NOT_FOUND', 'Content not found');
    }

    // Check if already deleted (for soft-deleted content)
    if (content.deletedAt) {
      const forceDelete = event.queryStringParameters?.force === 'true';
      if (!forceDelete) {
        return respondError(404, 'NOT_FOUND', 'Content already deleted');
      }
    }

    // Check ownership
    const isOwner = content.userId === userId;
    if (!isOwner && !isUserAdmin) {
      return respondError(403, 'PERMISSION_DENIED', 'You are not authorized to delete this content');
    }

    // Determine delete type
    const forceDelete = event.queryStringParameters?.force === 'true';
    const softDeleteRaw = process.env.ENABLE_SOFT_DELETE;
    if (!softDeleteRaw || softDeleteRaw.trim().length === 0) {
      return respondError(500, 'INTERNAL_ERROR', 'ENABLE_SOFT_DELETE must be set');
    }
    const softDeleteValue = softDeleteRaw.trim().toLowerCase();
    if (softDeleteValue !== 'true' && softDeleteValue !== 'false') {
      return respondError(500, 'INTERNAL_ERROR', 'ENABLE_SOFT_DELETE must be set to true or false');
    }
    const softDeleteEnabled = softDeleteValue === 'true';

    // Only admins can force delete
    if (forceDelete && !isUserAdmin) {
      return respondError(403, 'PERMISSION_DENIED', 'Force delete requires admin privileges');
    }

    const softDelete = !forceDelete && softDeleteEnabled;

    try {
      // Use ContentRepository's deleteContent method
      // This handles both soft delete and hard delete, including CASCADE for content_urls
      const success = await contentRepository.deleteContent(contentId, softDelete);

      if (!success) {
        return respondError(500, 'INTERNAL_ERROR', 'Failed to delete content');
      }

      console.log(`Content ${softDelete ? 'soft' : 'hard'} deleted successfully:`, contentId);

      const { ['Content-Type']: _contentType, ...headers } = responseHeaders(originHeader);
      return attachRateLimitHeaders({
        statusCode: 204,
        headers: {
          ...headers,
          'Content-Length': '0',
        },
        body: '',
      }, rateLimit);
    } catch (deleteError) {
      console.error('Error during delete operation:', deleteError);
      return respondError(500, 'INTERNAL_ERROR', 'Failed to delete content');
    }
  } catch (error: any) {
    console.error('Unexpected delete error:', error);
    const origin = event.headers?.Origin || event.headers?.origin || undefined;
    return attachRateLimitHeaders(
      errorResponse(500, 'INTERNAL_ERROR', 'Failed to delete content', origin),
      rateLimit
    );
  }
}
