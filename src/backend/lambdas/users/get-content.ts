import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ContentRepository, ContentViewOptions } from '../../repositories/ContentRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ContentType, Visibility } from '@aws-community-hub/shared';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../auth/utils';
import { getDatabasePool } from '../../services/database';
import { applyRateLimit, attachRateLimitHeaders } from '../../services/rateLimitPolicy';
import { resolveAuthorizerContext } from '../../services/authorizerContext';

interface UserContentQueryParams {
  limit?: string;
  offset?: string;
  visibility?: string;
  contentType?: string;
  contentTypes?: string;
  tags?: string;
}

const parseCsv = (value?: string): string[] =>
  value
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const normalizeContentUrls = (contentId: string, rawUrls: any[]): Array<{ id: string; url: string }> => {
  return (rawUrls || [])
    .filter((url) => url !== null && url !== undefined)
    .map((entry: any, index: number) => {
      if (typeof entry === 'string') {
        return { id: `url-${contentId}-${index}`, url: entry };
      }

      if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
        return {
          id: entry.id ?? `url-${contentId}-${index}`,
          url: entry.url,
        };
      }

      return null;
    })
    .filter((entry): entry is { id: string; url: string } => Boolean(entry?.url));
};

const asIsoString = (value: any): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/**
 * Get user content with visibility filtering
 * GET /users/{id}/content
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get user content request:', JSON.stringify(event, null, 2));

  try {
    const originHeader = event.headers?.Origin || event.headers?.origin || undefined;
    const corsOptions = { origin: originHeader, methods: 'GET,OPTIONS', allowCredentials: true };
    const sourceIp =
      typeof event.requestContext?.identity?.sourceIp === 'string' && event.requestContext.identity.sourceIp.length > 0
        ? event.requestContext.identity.sourceIp
        : 'anonymous';
    const authContext = resolveAuthorizerContext(event.requestContext?.authorizer as any);
    const viewerId = authContext.userId;
    let rateLimit: Awaited<ReturnType<typeof applyRateLimit>> = null;
    const withRateLimit = (response: APIGatewayProxyResult): APIGatewayProxyResult =>
      attachRateLimitHeaders(response, rateLimit);

    const rawUserId = event.pathParameters?.id;

    const queryParams = (event.queryStringParameters || {}) as UserContentQueryParams;

    let limit: number | undefined;
    if (queryParams.limit) {
      const parsedLimit = parseInt(queryParams.limit, 10);
      if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid limit parameter',
          { limit: 'Must be a positive integer' },
          corsOptions
        ));
      }
      if (parsedLimit > 100) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Limit exceeds maximum allowed value',
          { limit: 'Maximum is 100' },
          corsOptions
        ));
      }
      limit = parsedLimit;
    }

    let offset: number | undefined;
    if (queryParams.offset) {
      const parsedOffset = parseInt(queryParams.offset, 10);
      if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
        return withRateLimit(createErrorResponse(
          400,
          'VALIDATION_ERROR',
          'Invalid offset parameter',
          { offset: 'Must be non-negative' },
          corsOptions
        ));
      }
      offset = parsedOffset;
    }

    const visibilityValues = parseCsv(queryParams.visibility);
    const invalidVisibility = visibilityValues.filter(
      (value) => !Object.values(Visibility).includes(value as Visibility)
    );
    if (invalidVisibility.length > 0) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        `Invalid visibility value(s): ${invalidVisibility.join(', ')}`,
        undefined,
        corsOptions
      ));
    }

    const contentTypeParam = queryParams.contentType ?? queryParams.contentTypes;
    const contentTypes = parseCsv(contentTypeParam);
    const invalidContentTypes = contentTypes.filter(
      (value) => !Object.values(ContentType).includes(value as ContentType)
    );
    if (invalidContentTypes.length > 0) {
      return withRateLimit(createErrorResponse(
        400,
        'VALIDATION_ERROR',
        `Invalid content type(s): ${invalidContentTypes.join(', ')}`,
        undefined,
        corsOptions
      ));
    }

    const tagValues = parseCsv(queryParams.tags);

    rateLimit = await applyRateLimit(event, {
      resource: 'users:content',
      viewerId,
      sourceIp,
    });

    if (rateLimit && !rateLimit.allowed) {
      return withRateLimit(
        createErrorResponse(429, 'RATE_LIMITED', 'Too many requests', undefined, corsOptions)
      );
    }

    if (!rawUserId) {
      return withRateLimit(
        createErrorResponse(400, 'VALIDATION_ERROR', 'User ID is required in path', undefined, corsOptions)
      );
    }

    if (rawUserId === 'me') {
      if (!viewerId) {
        return withRateLimit(
          createErrorResponse(401, 'AUTH_REQUIRED', 'Authentication required', undefined, corsOptions)
        );
      }
    }

    const targetUserId = rawUserId === 'me' ? viewerId! : rawUserId;

    const dbPool = await getDatabasePool();
    const userRepository = new UserRepository(dbPool);
    const contentRepository = new ContentRepository(dbPool);

    const user = await userRepository.findById(targetUserId);
    if (!user) {
      return withRateLimit(
        createErrorResponse(404, 'NOT_FOUND', 'User not found', undefined, corsOptions)
      );
    }

    const options: ContentViewOptions = {
      viewerId: viewerId ?? null,
      limit,
      offset,
      filters: {},
    };

    if (visibilityValues.length > 0) {
      options.filters!.visibility = visibilityValues as Visibility[];
    }
    if (contentTypes.length > 0) {
      options.filters!.contentTypes = contentTypes as ContentType[];
    }
    if (tagValues.length > 0) {
      options.filters!.tags = tagValues;
    }

    const contentItems = await contentRepository.findByUserId(targetUserId, options);
    let total = contentItems.length;

    if (limit !== undefined || offset !== undefined) {
      const allItems = await contentRepository.findByUserId(targetUserId, {
        ...options,
        limit: undefined,
        offset: undefined,
      });
      total = allItems.length;
    }

    const content = contentItems.map((item) => ({
      id: item.id,
      userId: item.userId,
      title: item.title,
      description: item.description,
      contentType: item.contentType,
      visibility: item.visibility,
      publishDate: asIsoString(item.publishDate),
      captureDate: asIsoString(item.captureDate),
      metrics: item.metrics ?? {},
      tags: item.tags ?? [],
      isClaimed: item.isClaimed,
      originalAuthor: item.originalAuthor ?? null,
      urls: normalizeContentUrls(item.id, item.urls as any),
      createdAt: asIsoString(item.createdAt),
      updatedAt: asIsoString(item.updatedAt),
      deletedAt: asIsoString(item.deletedAt),
      version: item.version,
    }));

    return withRateLimit(createSuccessResponse(200, { content, total }, corsOptions));
  } catch (error: any) {
    console.error('Unexpected get user content error:', error);
    return createErrorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', undefined, {
      origin: event.headers?.Origin || event.headers?.origin || undefined,
      methods: 'GET,OPTIONS',
      allowCredentials: true,
    });
  }
}
