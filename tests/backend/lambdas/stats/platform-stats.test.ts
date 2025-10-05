import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/stats/platform-stats';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { Pool, QueryResult } from 'pg';

// Mock database pool
jest.mock('../../../../src/backend/services/database');

const mockGetDatabasePool = getDatabasePool as jest.MockedFunction<typeof getDatabasePool>;

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

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as unknown as Partial<Pool>;

    mockGetDatabasePool.mockResolvedValue(mockPool as Pool);
  });

  describe('GET /stats', () => {
    it('should return platform statistics successfully', async () => {
      const mockStatsData = {
        rows: [
          {
            contributors: 5000,
            content_pieces: 50000,
            daily_content: 100,
            weekly_active_users: 1000,
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(result.body);
      expect(body).toEqual({
        contributors: 5000,
        contentPieces: 50000,
        dailyContent: 100,
        weeklyActiveUsers: 1000,
        uptime: '24/7',
        lastUpdated: expect.any(String),
      });

      expect(new Date(body.lastUpdated).toISOString()).toBe(body.lastUpdated);
    });

    it('should handle zero statistics', async () => {
      const mockStatsData = {
        rows: [
          {
            contributors: 0,
            content_pieces: 0,
            daily_content: 0,
            weekly_active_users: 0,
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.contributors).toBe(0);
      expect(body.contentPieces).toBe(0);
      expect(body.dailyContent).toBe(0);
      expect(body.weeklyActiveUsers).toBe(0);
    });

    it('should handle OPTIONS request for CORS', async () => {
      const event = createEvent({ httpMethod: 'OPTIONS' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      });
      expect(result.body).toBe('');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return correct CORS headers', async () => {
      const mockStatsData = {
        rows: [{ contributors: 100, content_pieces: 1000, daily_content: 10, weekly_active_users: 50 }],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Content-Type': 'application/json',
      });
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
            contributors: 5000,
            content_pieces: 50000,
            daily_content: 100,
            weekly_active_users: 1000,
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);

      expect(body).toHaveProperty('contributors');
      expect(body).toHaveProperty('contentPieces');
      expect(body).toHaveProperty('dailyContent');
      expect(body).toHaveProperty('weeklyActiveUsers');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('lastUpdated');

      expect(typeof body.contributors).toBe('number');
      expect(typeof body.contentPieces).toBe('number');
      expect(typeof body.dailyContent).toBe('number');
      expect(typeof body.weeklyActiveUsers).toBe('number');
      expect(typeof body.uptime).toBe('string');
      expect(typeof body.lastUpdated).toBe('string');
    });

    it('should use camelCase for JSON response fields', async () => {
      const mockStatsData = {
        rows: [
          {
            contributors: 123,
            content_pieces: 456,
            daily_content: 789,
            weekly_active_users: 101,
          },
        ],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent();
      const result = await handler(event);

      const body = JSON.parse(result.body);

      expect(body.contentPieces).toBeDefined();
      expect(body.dailyContent).toBeDefined();
      expect(body.weeklyActiveUsers).toBeDefined();
      expect(body.lastUpdated).toBeDefined();

      expect(body.content_pieces).toBeUndefined();
      expect(body.daily_content).toBeUndefined();
      expect(body.weekly_active_users).toBeUndefined();
    });
  });

  describe('Public Endpoint Access', () => {
    it('should work without authentication', async () => {
      const mockStatsData = {
        rows: [{ contributors: 100, content_pieces: 1000, daily_content: 10, weekly_active_users: 50 }],
      };

      mockQuery.mockResolvedValueOnce(mockStatsData as QueryResult);

      const event = createEvent({ headers: {} });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toHaveProperty('contributors');
    });
  });

  describe('Performance', () => {
    it('should execute query efficiently', async () => {
      const mockStatsData = {
        rows: [{ contributors: 100, content_pieces: 1000, daily_content: 10, weekly_active_users: 50 }],
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
        rows: [{ contributors: 100, content_pieces: 1000, daily_content: 10, weekly_active_users: 50 }],
      };

      mockQuery.mockResolvedValue(mockStatsData as QueryResult);

      await handler(createEvent());
      await handler(createEvent());
      await handler(createEvent());

      expect(mockGetDatabasePool).toHaveBeenCalledTimes(3);
    });
  });
});
