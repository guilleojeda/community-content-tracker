import { APIGatewayProxyEvent } from 'aws-lambda';
import { consumeRateLimit } from './rateLimiter';

export interface RateLimitConfig {
  anonymousLimit: number;
  authenticatedLimit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  reset: number;
  limit: number;
  key: string;
}

const parsePositiveInt = (value: string | undefined, name: string): number => {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
};

export const getRateLimitConfig = (): RateLimitConfig => {
  const anonymousLimit = parsePositiveInt(process.env.RATE_LIMIT_ANONYMOUS, 'RATE_LIMIT_ANONYMOUS');
  const authenticatedLimit = parsePositiveInt(process.env.RATE_LIMIT_AUTHENTICATED, 'RATE_LIMIT_AUTHENTICATED');
  const windowMinutes = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 'RATE_LIMIT_WINDOW_MINUTES');
  return {
    anonymousLimit,
    authenticatedLimit,
    windowMs: Math.max(windowMinutes, 1) * 60_000,
  };
};

const getViewerContext = (event: APIGatewayProxyEvent): { userId?: string; sourceIp: string } => {
  const authorizer = (event.requestContext?.authorizer ?? {}) as {
    userId?: string;
    claims?: Record<string, unknown>;
  };
  const claims =
    authorizer.claims && typeof authorizer.claims === 'object' ? authorizer.claims : {};
  const claimSub = typeof claims.sub === 'string' ? claims.sub : undefined;
  const claimUsername =
    typeof (claims as Record<string, unknown>)['cognito:username'] === 'string'
      ? (claims as Record<string, unknown>)['cognito:username']
      : undefined;
  const directUserId = typeof authorizer.userId === 'string' ? authorizer.userId : undefined;
  const userId = (directUserId ?? claimSub ?? claimUsername) as string | undefined;
  const sourceIp =
    typeof event.requestContext?.identity?.sourceIp === 'string' &&
    event.requestContext.identity.sourceIp.length > 0
      ? event.requestContext.identity.sourceIp
      : 'anonymous';

  return { userId, sourceIp };
};

export async function applyRateLimit(
  event: APIGatewayProxyEvent,
  options: {
    resource: string;
    skipIfAuthorized?: boolean;
    viewerId?: string;
    sourceIp?: string;
  }
): Promise<RateLimitDecision | null> {
  const { resource, skipIfAuthorized } = options;
  const context = getViewerContext(event);
  const userId = options.viewerId ?? context.userId;
  const sourceIp = options.sourceIp ?? context.sourceIp;

  if (skipIfAuthorized && userId) {
    return null;
  }

  const config = getRateLimitConfig();
  const limit = userId ? config.authenticatedLimit : config.anonymousLimit;
  const key = userId ? `${resource}:user:${userId}` : `${resource}:ip:${sourceIp}`;
  const rateLimitPrefix = userId ? 'auth' : 'anon';

  const result = await consumeRateLimit(key, limit, config.windowMs, rateLimitPrefix);

  return {
    ...result,
    limit,
    key,
  };
}

export const buildRateLimitHeaders = (rateLimit?: RateLimitDecision | null): Record<string, string> => {
  if (!rateLimit) {
    return {};
  }

  return {
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': rateLimit.reset.toString(),
    'X-RateLimit-Limit': rateLimit.limit.toString(),
  };
};

export const attachRateLimitHeaders = <T extends { headers?: Record<string, string | number | boolean> }>(
  response: T,
  rateLimit?: RateLimitDecision | null
): T => {
  if (!rateLimit) {
    return response;
  }

  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      ...buildRateLimitHeaders(rateLimit),
    },
  };
};
