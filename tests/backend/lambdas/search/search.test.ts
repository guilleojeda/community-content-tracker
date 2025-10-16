import { handler } from '../../../../src/backend/lambdas/search/search';
import { getDatabasePool } from '../../../../src/backend/services/database';
import { ContentType, Visibility, BadgeType } from '@aws-community-hub/shared';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Pool } from 'pg';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn()
}));

jest.mock('../../../../src/backend/services/SearchService', () => ({
  getSearchService: jest.fn(),
  SearchService: jest.fn()
}));

describe('GET /search Lambda handler', () => {
  let mockSearchService: any;
  let mockPool: jest.Mocked<Pool>;
  let mockGetSearchService: jest.MockedFunction<any>;
  let mockGetDatabasePool: jest.MockedFunction<typeof getDatabasePool>;

  beforeEach(() => {
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
      identity: {} as any,
      authorizer: authorizer || null,
      resourceId: 'test',
      resourcePath: '/search'
    },
    body: null,
    isBase64Encoded: false
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Content-Type': 'application/json'
      });
    });
  });
});
