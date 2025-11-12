import { handler } from '@lambdas/search/searchHandler';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { ContentType, Visibility, BadgeType } from '@aws-community-hub/shared';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Pool } from 'pg';
import { consumeRateLimit } from '../../../../src/backend/services/rateLimiter';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn()
}));

jest.mock('../../../../src/backend/services/SearchService', () => ({
  getSearchService: jest.fn(),
  SearchService: jest.fn()
}));

jest.mock('../../../../src/backend/services/rateLimiter', () => ({
  __esModule: true,
  consumeRateLimit: jest.fn(),
}));

const originalEnv = process.env;

describe('GET /search Lambda handler', () => {
  let mockSearchService: any;
  let mockPool: jest.Mocked<Pool>;
  let mockGetSearchService: jest.MockedFunction<any>;
  let mockGetDatabasePool: jest.MockedFunction<typeof getDatabasePool>;
  const mockConsumeRateLimit = consumeRateLimit as jest.MockedFunction<typeof consumeRateLimit>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();

    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn()
    } as unknown as jest.Mocked<Pool>;

    // Create mock search service
    mockSearchService = {
      search: jest.fn()
    };

    // Mock getDatabasePool
    mockGetDatabasePool = getDatabasePool as jest.MockedFunction<typeof getDatabasePool>;
    mockGetDatabasePool.mockResolvedValue(mockPool);

    // Mock getSearchService
    const { getSearchService } = require('../../../../src/backend/services/SearchService');
    mockGetSearchService = getSearchService as jest.MockedFunction<any>;
    mockGetSearchService.mockReturnValue(mockSearchService);
    mockConsumeRateLimit.mockResolvedValue({ allowed: true, remaining: 99, reset: Date.now() + 60000 });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createEvent = (queryParams: Record<string, string> = {}, authorizer?: any): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/search',
    resource: '/search',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: queryParams,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: '/search',
      stage: 'test',
      requestId: 'test',
      requestTime: 'test',
      requestTimeEpoch: 0,
      identity: { sourceIp: '127.0.0.1' } as any,
      authorizer: authorizer || null,
      resourceId: 'test',
      resourcePath: '/search'
    },
    body: null,
    isBase64Encoded: false
  });

  describe('rate limiting configuration', () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_ANONYMOUS = '50';
      process.env.RATE_LIMIT_AUTHENTICATED = '500';
      process.env.RATE_LIMIT_WINDOW_MINUTES = '2';
    });

    it('uses anonymous rate limit configuration for unauthenticated users', async () => {
      const event = createEvent({ q: 'AWS' });
      mockSearchService.search = jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await handler(event);

      expect(mockConsumeRateLimit).toHaveBeenCalledWith(
        expect.stringMatching(/^search:ip:/),
        50,
        120_000,
        'anon'
      );
    });

    it('uses authenticated rate limit configuration when viewer ID is present', async () => {
      const event = createEvent({ q: 'AWS' }, { userId: 'user-123' });
      mockSearchService.search = jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await handler(event);

      expect(mockConsumeRateLimit).toHaveBeenCalledWith(
        'search:user:user-123',
        500,
        120_000,
        'auth'
      );
    });
  });

  describe('when performing a search query', () => {
    it('should return search results for valid query', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS Lambda' });
      const mockResults = {
        items: [
          {
            id: '1',
            userId: 'user1',
            title: 'AWS Lambda Guide',
            description: 'Comprehensive guide',
            contentType: ContentType.BLOG,
            visibility: Visibility.PUBLIC,
            publishDate: new Date(),
            captureDate: new Date(),
            metrics: {},
            tags: ['aws', 'lambda'],
            isClaimed: true,
            urls: [{ id: '1', url: 'https://example.com' }],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        total: 1,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
    const response = await handler(event) as APIGatewayProxyResult;

    // Assert
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe('AWS Lambda Guide');
    expect(response.headers?.['X-RateLimit-Remaining']).toBeDefined();
    expect(mockSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'AWS Lambda',
        filters: undefined,
      }),
      false,
      [],
      false
    );
  });

    it('should return 400 for missing query parameter', async () => {
      // Arrange
      const event = createEvent({});

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('query parameter');
    });

    it('should return 400 for empty query', async () => {
      // Arrange
      const event = createEvent({ q: '' });

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle pagination parameters', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS', limit: '5', offset: '10' });
      const mockResults = {
        items: [],
        total: 100,
        limit: 5,
        offset: 10
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          limit: 5,
          offset: 10
        }),
        false,
        [],
        false
      );
    });

    it('should safely handle SQL-like input patterns', async () => {
      const event = createEvent({ q: "1' OR '1'='1" });
      const mockResults = { items: [], total: 0, limit: 10, offset: 0 };
      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      const response = await handler(event) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(200);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: "1' OR '1'='1" }),
        false,
        [],
        false
      );
    });

    it('should enforce rate limiting for anonymous users', async () => {
      mockConsumeRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, reset: Date.now() + 60000 });

      const event = createEvent({ q: 'AWS' });
      const response = await handler(event) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('should use default pagination values', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS' });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          limit: 10,
          offset: 0
        }),
        false,
        [],
        false
      );
    });
  });

  describe('when filtering search results', () => {
    it('should filter by content types', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        type: 'blog,youtube'
      });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          filters: expect.objectContaining({
            contentTypes: [ContentType.BLOG, ContentType.YOUTUBE]
          })
        }),
        false,
        [],
        false
      );
    });

    it('should filter by tags', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        tags: 'serverless,lambda'
      });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          filters: expect.objectContaining({
            tags: ['serverless', 'lambda']
          })
        }),
        false,
        [],
        false
      );
    });

    it('sanitizes tags to remove unsafe characters', async () => {
      const event = createEvent({
        q: 'AWS',
        tags: 'serverless,<script>alert(1)</script>'
      });

      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      await handler(event);

      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            tags: ['serverless', 'scriptalert1script']
          })
        }),
        false,
        [],
        false
      );
    });

    it('should filter by badges', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        badges: 'hero,community_builder'
      });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          filters: expect.objectContaining({
            badges: [BadgeType.HERO, BadgeType.COMMUNITY_BUILDER]
          })
        }),
        false,
        [],
        false
      );
    });

    it('should filter by date range', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          filters: expect.objectContaining({
            dateRange: {
              start: new Date('2024-01-01'),
              end: new Date('2024-12-31')
            }
          })
        }),
        false,
        [],
        false
      );
    });

    it('returns validation error when startDate is after endDate', async () => {
      const event = createEvent({
        q: 'AWS',
        startDate: '2024-02-01',
        endDate: '2024-01-01'
      });

      const response = await handler(event) as APIGatewayProxyResult;
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('startDate must be before endDate');
    });

    it('should filter by visibility', async () => {
      const event = createEvent({
        q: 'AWS',
        visibility: 'public,aws_only'
      }, {
        userId: 'user-123',
        isAwsEmployee: 'true'
      });

      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      await handler(event);

      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS',
          filters: expect.objectContaining({
            visibility: [Visibility.PUBLIC, Visibility.AWS_ONLY]
          })
        }),
        true,
        [],
        true
      );
    });

    it('should return 400 for invalid visibility values', async () => {
      const event = createEvent({
        q: 'AWS',
        visibility: 'public,invalid'
      });

      const response = await handler(event) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid visibility value');
    });
  });

  describe('when handling authentication', () => {
    it('should work for anonymous users', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS' });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(200);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS'
        }),
        false,
        [],
        false
      );
    });

    it('should include viewer ID for authenticated users', async () => {
      // Arrange
      const event = createEvent(
        { q: 'AWS' },
        { userId: 'user-123' }
      );
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS'
        }),
        true,
        [],
        false
      );
    });

    it('should include viewer badges for users with badges', async () => {
      // Arrange
      const event = createEvent(
        { q: 'AWS' },
        {
          userId: 'user-123',
          badges: JSON.stringify([BadgeType.HERO])
        }
      );
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      await handler(event);

      // Assert
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'AWS'
        }),
        true,
        [BadgeType.HERO],
        false
      );
    });

    it('ignores malformed badge payloads in authorizer context', async () => {
      const event = createEvent(
        { q: 'AWS' },
        { userId: 'user-123', badges: 'not-json' }
      );

      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      await handler(event);

      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'AWS' }),
        true,
        [],
        false
      );
    });
  });

  describe('error handling', () => {
    it('should return 500 for search service errors', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS' });
      mockSearchService.search = jest.fn().mockRejectedValue(
        new Error('Search service failed')
      );

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should return 400 for invalid content type filter', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        type: 'invalid_type'
      });

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid badge filter', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        badges: 'invalid_badge'
      });

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid date format', async () => {
      // Arrange
      const event = createEvent({
        q: 'AWS',
        startDate: 'invalid-date'
      });

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when limit is outside allowed range', async () => {
      const event = createEvent({
        q: 'AWS',
        limit: '101'
      });

      const response = await handler(event) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('limit must be between 1 and 100');
    });

    it('should return 400 when date range is partially provided', async () => {
      const event = createEvent({
        q: 'AWS',
        startDate: '2024-01-01'
      });

      const response = await handler(event) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Both startDate and endDate must be provided');
    });

    it('should return 400 when tags filter is emptied after sanitization', async () => {
      const event = createEvent({
        q: 'AWS',
        tags: '!!!'
      });

      const response = await handler(event) as APIGatewayProxyResult;
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Tags filter');
    });
  });

  describe('rate limit configuration defaults', () => {
    it('falls back to documented defaults when environment values are invalid', async () => {
      process.env.RATE_LIMIT_ANONYMOUS = '-1';
      process.env.RATE_LIMIT_AUTHENTICATED = '0';
      process.env.RATE_LIMIT_WINDOW_MINUTES = '0';

      const event = createEvent({ q: 'AWS' });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      await handler(event);

      expect(mockConsumeRateLimit).toHaveBeenCalledWith(
        expect.stringMatching(/^search:ip:/),
        100,
        60_000,
        'anon'
      );
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in response', async () => {
      // Arrange
      const event = createEvent({ q: 'AWS' });
      const mockResults = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0
      };

      mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

      // Act
      const response = await handler(event) as APIGatewayProxyResult;

      // Assert
      expect(response.headers).toMatchObject({
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Content-Type': 'application/json',
        Vary: 'Origin',
      });
    });
  });

  it('falls back to anonymous identifiers when request context is missing', async () => {
    const event = createEvent({ q: 'AWS' }) as APIGatewayProxyEvent;
    (event as any).requestContext = undefined;

    const mockResults = { items: [], total: 0, limit: 10, offset: 0 };
    mockSearchService.search = jest.fn().mockResolvedValue(mockResults);

    await handler(event);

    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      'search:ip:anonymous',
      100,
      60_000,
      'anon'
    );
  });
});
