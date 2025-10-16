/**
 * @test Content Merge API
 * @description Comprehensive tests for POST /content/merge endpoint
 * @coverage Target: >90%
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock database pool FIRST
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
};

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn().mockResolvedValue(mockPool),
  closeDatabasePool: jest.fn(),
  setTestDatabasePool: jest.fn(),
  resetDatabaseCache: jest.fn(),
}));

// Mock ContentRepository with class pattern
jest.mock('../../../../src/backend/repositories/ContentRepository', () => {
  const mockFindById = jest.fn();
  const mockMergeContent = jest.fn();
  const mockGetMergeHistory = jest.fn();

  class MockContentRepository {
    findById = mockFindById;
    mergeContent = mockMergeContent;
    getMergeHistory = mockGetMergeHistory;

    static mockFindById = mockFindById;
    static mockMergeContent = mockMergeContent;
    static mockGetMergeHistory = mockGetMergeHistory;
  }

  return { ContentRepository: MockContentRepository };
});

// Mock UserRepository with class pattern
jest.mock('../../../../src/backend/repositories/UserRepository', () => {
  const mockFindById = jest.fn();

  class MockUserRepository {
    findById = mockFindById;

    static mockFindById = mockFindById;
  }

  return { UserRepository: MockUserRepository };
});

// Mock AuditLogService with class pattern
jest.mock('../../../../src/backend/services/AuditLogService', () => {
  const mockLogContentMerge = jest.fn();

  class MockAuditLogService {
    logContentMerge = mockLogContentMerge;

    static mockLogContentMerge = mockLogContentMerge;
  }

  return { AuditLogService: MockAuditLogService };
});

// Mock NotificationService with class pattern
jest.mock('../../../../src/backend/services/NotificationService', () => {
  const mockNotifyContentMerged = jest.fn();

  class MockNotificationService {
    notifyContentMerged = mockNotifyContentMerged;

    static mockNotifyContentMerged = mockNotifyContentMerged;
  }

  return { NotificationService: MockNotificationService };
});

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  })),
}));

// Import handler and services AFTER mocks are set up
import { handler } from '../../../../src/backend/lambdas/content/merge';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { AuditLogService } from '../../../../src/backend/services/AuditLogService';
import { NotificationService } from '../../../../src/backend/services/NotificationService';

// Access the mock methods from the mocked classes
const mockContentRepository = ContentRepository as jest.MockedClass<typeof ContentRepository>;
const mockUserRepository = UserRepository as jest.MockedClass<typeof UserRepository>;
const mockAuditLogService = AuditLogService as jest.MockedClass<typeof AuditLogService>;
const mockNotificationServiceClass = NotificationService as jest.MockedClass<typeof NotificationService>;

const mockFindById = (mockContentRepository as any).mockFindById;
const mockMergeContent = (mockContentRepository as any).mockMergeContent;
const mockGetMergeHistory = (mockContentRepository as any).mockGetMergeHistory;
const mockUserFindById = (mockUserRepository as any).mockFindById;
const mockLogContentMerge = (mockAuditLogService as any).mockLogContentMerge;
const mockNotifyContentMerged = (mockNotificationServiceClass as any).mockNotifyContentMerged;

describe('Content Merge Handler', () => {
  let mockContext: Context;

  const adminUserId = '550e8400-e29b-41d4-a716-446655440000';
  const regularUserId = '660e8400-e29b-41d4-a716-446655440001';
  const contentId1 = '770e8400-e29b-41d4-a716-446655440010';
  const contentId2 = '880e8400-e29b-41d4-a716-446655440011';
  const contentId3 = '990e8400-e29b-41d4-a716-446655440012';
  const contentId4 = 'aa0e8400-e29b-41d4-a716-446655440013';
  const mergedContentId = 'bb0e8400-e29b-41d4-a716-446655440020';

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      requestId: 'test-request-id',
      functionName: 'merge-content',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:merge-content',
      memoryLimitInMB: '128',
      awsRequestId: 'test-aws-request-id',
      logGroupName: '/aws/lambda/merge-content',
      logStreamName: '2025/09/29/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
      callbackWaitsForEmptyEventLoop: false,
    };
  });

  describe('POST /content/merge - Basic Functionality', () => {
    it('should successfully merge two content items', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1,
          reason: 'Duplicate content from same author'
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const mockContent1 = {
        id: contentId1,
        userId: regularUserId,
        title: 'Introduction to AWS Lambda',
        originalAuthor: 'John Doe',
        publishDate: new Date('2025-01-01'),
        urls: ['https://example.com/post1'],
        contentType: 'article',
        tags: ['aws', 'lambda']
      };

      const mockContent2 = {
        id: contentId2,
        userId: regularUserId,
        title: 'Getting Started with AWS Lambda',
        originalAuthor: 'John Doe',
        publishDate: new Date('2025-02-01'),
        urls: ['https://example.com/post2'],
        contentType: 'article',
        tags: ['aws', 'serverless']
      };

      const mockMergedContent = {
        id: contentId1,
        userId: regularUserId,
        title: 'Introduction to AWS Lambda',
        originalAuthor: 'John Doe',
        publishDate: new Date('2025-01-01'),
        urls: ['https://example.com/post1', 'https://example.com/post2'],
        contentType: 'article',
        tags: ['aws', 'lambda', 'serverless']
      };

      const mockMergeHistory = {
        id: 'cc0e8400-e29b-41d4-a716-446655440021',
        primaryContentId: contentId1,
        mergedContentIds: [contentId2],
        mergedBy: adminUserId,
        mergedAt: new Date(),
        canUndo: true,
        undoDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        reason: 'Duplicate content from same author'
      };

      mockFindById
        .mockResolvedValueOnce(mockContent1)
        .mockResolvedValueOnce(mockContent2);

      mockMergeContent.mockResolvedValue(mockMergedContent);
      mockGetMergeHistory.mockResolvedValue([mockMergeHistory]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.content.urls).toHaveLength(2);
      expect(body.merged.primaryId).toBe(contentId1);
      expect(body.merged.mergedIds).toEqual([contentId2]);
      expect(mockLogContentMerge).toHaveBeenCalled();
      expect(mockNotifyContentMerged).toHaveBeenCalled();
    });

    it('should merge multiple content items (>2)', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2, contentId3, contentId4],
          primaryId: contentId1,
          reason: 'Multiple duplicates found'
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const mockContents = [
        {
          id: contentId1,
          userId: regularUserId,
          title: 'Title 1',
          publishDate: new Date('2025-03-01'),
          urls: ['https://example.com/1']
        },
        {
          id: contentId2,
          userId: regularUserId,
          title: 'Title 2',
          publishDate: new Date('2025-01-01'),
          urls: ['https://example.com/2']
        },
        {
          id: contentId3,
          userId: regularUserId,
          title: 'Title 3',
          publishDate: new Date('2025-02-01'),
          urls: ['https://example.com/3']
        },
        {
          id: contentId4,
          userId: regularUserId,
          title: 'Title 4',
          publishDate: new Date('2025-04-01'),
          urls: ['https://example.com/4']
        }
      ];

      const mockMergedContent = {
        id: contentId1,
        userId: regularUserId,
        title: 'Title 1',
        publishDate: new Date('2025-01-01'),
        urls: mockContents.map(c => c.urls[0]),
        tags: []
      };

      mockFindById
        .mockResolvedValueOnce(mockContents[0])
        .mockResolvedValueOnce(mockContents[1])
        .mockResolvedValueOnce(mockContents[2])
        .mockResolvedValueOnce(mockContents[3]);

      mockMergeContent.mockResolvedValue(mockMergedContent);
      mockGetMergeHistory.mockResolvedValue([{
        id: 'ee0e8400-e29b-41d4-a716-446655440023',
        primaryContentId: contentId1,
        mergedContentIds: [contentId2, contentId3, contentId4],
        canUndo: true,
        undoDeadline: new Date()
      }]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.content.urls).toHaveLength(4);
      expect(body.merged.mergedIds).toHaveLength(3);
    });
  });

  describe('POST /content/merge - Validation', () => {
    it('should require authentication', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {}
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should require at least 2 content IDs', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('At least 2 content IDs');
    });

    it('should require primaryId to be in contentIds', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId3
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('primaryId must be one of the contentIds');
    });

    it('should require primaryId field', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2]
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('primaryId is required');
    });

    it('should validate all source content exists', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2, contentId3],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      mockFindById
        .mockResolvedValueOnce({ id: contentId1, userId: regularUserId })
        .mockResolvedValueOnce({ id: contentId2, userId: regularUserId })
        .mockResolvedValueOnce(null); // contentId3 not found

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Content not found');
    });

    it('should prevent non-admin from merging content they do not own', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {
            userId: regularUserId,
            isAdmin: false
          }
        } as any
      };

      mockFindById
        .mockResolvedValueOnce({ id: contentId1, userId: regularUserId })
        .mockResolvedValueOnce({ id: contentId2, userId: adminUserId }); // Different owner

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PERMISSION_DENIED');
      expect(body.error.message).toContain('must own all content items');
    });

    it('should allow admin to merge content they do not own', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1,
          reason: 'Admin merge'
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      mockFindById
        .mockResolvedValueOnce({ id: contentId1, userId: regularUserId })
        .mockResolvedValueOnce({ id: contentId2, userId: regularUserId });

      mockMergeContent.mockResolvedValue({
        id: contentId1,
        urls: ['url1', 'url2'],
        tags: []
      });
      mockGetMergeHistory.mockResolvedValue([]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      mockFindById.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle merge operation failures', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      mockFindById
        .mockResolvedValueOnce({ id: contentId1, userId: regularUserId })
        .mockResolvedValueOnce({ id: contentId2, userId: regularUserId });

      mockMergeContent.mockRejectedValue(
        new Error('Transaction failed')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle invalid JSON in request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: 'invalid json{',
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Audit Trail', () => {
    it('should log merge operation in audit trail', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          contentIds: [contentId1, contentId2],
          primaryId: contentId1,
          reason: 'Duplicate detection'
        }),
        requestContext: {
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          }
        } as any
      };

      mockFindById
        .mockResolvedValueOnce({ id: contentId1, userId: regularUserId })
        .mockResolvedValueOnce({ id: contentId2, userId: regularUserId });

      mockMergeContent.mockResolvedValue({
        id: contentId1,
        urls: ['url1', 'url2'],
        tags: []
      });

      mockGetMergeHistory.mockResolvedValue([{
        id: 'dd0e8400-e29b-41d4-a716-446655440022',
        primaryContentId: contentId1,
        mergedContentIds: [contentId2],
        canUndo: true,
        undoDeadline: new Date()
      }]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockLogContentMerge).toHaveBeenCalledWith(
        adminUserId,
        contentId1,
        [contentId2],
        expect.objectContaining({
          reason: 'Duplicate detection'
        })
      );
    });
  });
});
