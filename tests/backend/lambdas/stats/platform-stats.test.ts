import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/stats/platform-stats';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { getCacheClient } from '../../../../src/backend/services/cache/cache';
import { consumeRateLimit } from '../../../../src/backend/services/rateLimiter';
import { Pool, QueryResult } from 'pg';

// Mock database pool
jest.mock('../../../../src/backend/services/database');
jest.mock('../../../../src/backend/services/cache/cache');
jest.mock('../../../../src/backend/services/rateLimiter');

const mockGetDatabasePool = getDatabasePool as jest.MockedFunction<typeof getDatabasePool>;
const mockGetCacheClient = getCacheClient as jest.MockedFunction<typeof getCacheClient>;
const mockConsumeRateLimit = consumeRateLimit as jest.MockedFunction<typeof consumeRateLimit>;

// Helper to create API Gateway event
const createEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/stats',
  headers: {},
  queryStringParameters: null,
  pathParameters: null,
  body: null,
  isBase64Encoded: false,
  requestContext: {
    accountId: 'test',
    apiId: 'test',
    protocol: 'HTTP/1.1',
    httpMethod: 'GET',
    path: '/stats',
    stage: 'test',
    requestId: 'test',
    requestTimeEpoch: Date.now(),
    resourceId: 'test',
    resourcePath: '/stats',
    identity: {
      accessKey: null,
      accountId: null,
      apiKey: null,
      apiKeyId: null,
      caller: null,
      clientCert: null,
      cognitoAuthenticationProvider: null,
      cognitoAuthenticationType: null,
      cognitoIdentityId: null,
      cognitoIdentityPoolId: null,
      principalOrgId: null,
      sourceIp: '127.0.0.1',
      user: null,
      userAgent: 'test',
      userArn: null,
    },
    authorizer: null,
  },
  stageVariables: null,
  resource: '/stats',
  multiValueHeaders: {},
  multiValueQueryStringParameters: null,
  ...overrides,
});

describe('Platform Stats Lambda', () => {
  let mockPool: Partial<Pool>;
  let mockQuery: jest.Mock;
  let mockCacheClient: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CORS_ORIGIN = 'http://localhost:3000';
    delete process.env.CORS_CREDENTIALS;
    process.env.STATS_CACHE_TTL = '60';

    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as unknown as Partial<Pool>;

    mockGetDatabasePool.mockResolvedValue(mockPool as Pool);
    mockCacheClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    mockGetCacheClient.mockResolvedValue(mockCacheClient as any);
    mockConsumeRateLimit.mockResolvedValue({ allowed: true, remaining: 99, reset: Date.now() + 60000 });
  });

  afterEach(() => {
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_CREDENTIALS;
    delete process.env.STATS_CACHE_TTL;
  });

  describe('GET /stats', () => {
    it('should return platform statistics successfully', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '5000',
            total_content: '50000',
            top_contributors: '1500',
            content_by_type: { blog: 1200, youtube: 800 },
            recent_activity: { last24h: 120, last7d: 540, last30d: 2200 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
        Vary: 'Origin',
      });

      const body = JSON.parse(result.body);
      expect(body).toEqual({
        totalUsers: 5000,
        totalContent: 50000,
        topContributors: 1500,
        contentByType: {
          blog: 1200,
          youtube: 800,
        },
        recentActivity: {
          last24h: 120,
          last7d: 540,
          last30d: 2200,
        },
        uptime: '24/7',
        lastUpdated: expect.any(String),
      });

      expect(new Date(body.lastUpdated).toISOString()).toBe(body.lastUpdated);
      expect(mockCacheClient.set).toHaveBeenCalledWith(
        'platform-stats',
        expect.objectContaining({
          totalUsers: 5000,
          totalContent: 50000,
          topContributors: 1500,
        }),
        60,
      );
      expect(result.headers).toMatchObject({
        'X-RateLimit-Remaining': '99',
      });
    });

    it('should handle zero statistics', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '0',
            total_content: '0',
            top_contributors: '0',
            content_by_type: null,
            recent_activity: null,
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.totalUsers).toBe(0);
      expect(body.totalContent).toBe(0);
      expect(body.topContributors).toBe(0);
      expect(body.contentByType).toEqual({});
      expect(body.recentActivity).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
    });

    it('should return cached stats when cache hit occurs', async () => {
      const cached = {
        totalUsers: 12,
        totalContent: 34,
        topContributors: 6,
        contentByType: { blog: 10 },
        recentActivity: { last24h: 1, last7d: 5, last30d: 12 },
        uptime: '24/7',
        lastUpdated: new Date().toISOString(),
      };

      mockCacheClient.get.mockResolvedValueOnce(cached);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(JSON.parse(result.body)).toEqual(cached);
    });

    it('should include cache-control headers', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_users: '1',
            total_content: '2',
            top_contributors: '1',
            content_by_type: { blog: 2 },
            recent_activity: { last24h: 1, last7d: 2, last30d: 3 },
          },
        ],
      } as QueryResult);

      const result = await handler(createEvent());

      expect(result.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=60, stale-while-revalidate=30');
    });

    it('should handle OPTIONS request for CORS', async () => {
      const event = createEvent({ httpMethod: 'OPTIONS' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        Vary: 'Origin',
      });
      expect(result.body).toBe('');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return correct CORS headers', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '100',
            total_content: '1000',
            top_contributors: '50',
            content_by_type: { blog: 400, youtube: 300 },
            recent_activity: { last24h: 10, last7d: 40, last30d: 120 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': process.env.CORS_ALLOW_HEADERS,
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Content-Type': 'application/json',
        Vary: 'Origin',
      });
    });

    it('should enforce anonymous rate limiting', async () => {
      mockConsumeRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, reset: Date.now() + 60000 });

      const result = await handler(createEvent());

      expect(result.statusCode).toBe(429);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('uses configured cache TTL when storing statistics', async () => {
      process.env.STATS_CACHE_TTL = '120';
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            total_users: '5',
            total_content: '20',
            top_contributors: '4',
            content_by_type: { blog: 10 },
            recent_activity: { last24h: 1, last7d: 3, last30d: 6 },
          },
        ],
      } as QueryResult);

      await handler(createEvent());

      expect(mockCacheClient.set).toHaveBeenCalledWith(
        'platform-stats',
        expect.objectContaining({
          totalUsers: 5,
          totalContent: 20,
          topContributors: 4,
        }),
        120,
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockGetDatabasePool.mockRejectedValueOnce(new Error('Database connection failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'An error occurred while fetching statistics',
      });
    });

    it('should handle database query errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query execution failed'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle unexpected errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Unexpected system error'));

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Response Format', () => {
    it('should match OpenAPI specification schema', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '5000',
            total_content: '50000',
            top_contributors: '1500',
            content_by_type: { blog: 1200, youtube: 800 },
            recent_activity: { last24h: 120, last7d: 540, last30d: 2200 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);

      expect(body).toHaveProperty('totalUsers');
      expect(body).toHaveProperty('totalContent');
      expect(body).toHaveProperty('topContributors');
      expect(body).toHaveProperty('contentByType');
      expect(body).toHaveProperty('recentActivity');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('lastUpdated');

      expect(typeof body.totalUsers).toBe('number');
      expect(typeof body.totalContent).toBe('number');
      expect(typeof body.topContributors).toBe('number');
      expect(typeof body.contentByType).toBe('object');
      expect(typeof body.recentActivity).toBe('object');
      expect(typeof body.uptime).toBe('string');
      expect(typeof body.lastUpdated).toBe('string');
    });

    it('should use camelCase for JSON response fields', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '123',
            total_content: '456',
            top_contributors: '101',
            content_by_type: { blog: 200 },
            recent_activity: { last24h: 10, last7d: 20, last30d: 30 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      const body = JSON.parse(result.body);

      expect(body.totalUsers).toBeDefined();
      expect(body.totalContent).toBeDefined();
      expect(body.topContributors).toBeDefined();
      expect(body.contentByType).toBeDefined();
      expect(body.recentActivity).toBeDefined();
      expect(body.lastUpdated).toBeDefined();

      expect(body.total_users).toBeUndefined();
      expect(body.total_content).toBeUndefined();
      expect(body.top_contributors).toBeUndefined();
      expect(body.content_by_type).toBeUndefined();
      expect(body.recent_activity).toBeUndefined();
    });
  });

  describe('Public Endpoint Access', () => {
    it('should work without authentication', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '100',
            total_content: '1000',
            top_contributors: '50',
            content_by_type: { blog: 400 },
            recent_activity: { last24h: 10, last7d: 40, last30d: 120 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent({ headers: {} });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toHaveProperty('totalUsers');
    });
  });

  describe('Performance', () => {
    it('should execute query efficiently', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '100',
            total_content: '1000',
            top_contributors: '50',
            content_by_type: { blog: 400 },
            recent_activity: { last24h: 10, last7d: 40, last30d: 120 },
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const startTime = Date.now();
      await handler(event);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should reuse database connection pool', async () => {
      const mockStatsData = {
        rows: [
          {
            total_users: '100',
            total_content: '1000',
            top_contributors: '50',
            content_by_type: { blog: 400 },
            recent_activity: { last24h: 10, last7d: 40, last30d: 120 },
          },
        ],
      };

      mockQuery.mockResolvedValue(mockStatsData as QueryResult);

      await handler(createEvent());
      await handler(createEvent());
      await handler(createEvent());

      expect(mockGetDatabasePool).toHaveBeenCalledTimes(3);
    });
  });
});
