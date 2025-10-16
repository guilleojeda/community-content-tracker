/**
 * @test Content Claiming API
 * @description Comprehensive tests for POST /content/:id/claim endpoint
 * @coverage Target: >90%
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/claim';

// Mock dependencies
jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

jest.mock('../../../../src/backend/repositories/ContentRepository');
jest.mock('../../../../src/backend/repositories/UserRepository');
jest.mock('../../../../src/backend/services/NotificationService');
jest.mock('../../../../src/backend/services/AuditLogService');

const mockPool = {
  query: jest.fn(),
};

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { ContentRepository } = require('../../../../src/backend/repositories/ContentRepository');
const { UserRepository } = require('../../../../src/backend/repositories/UserRepository');
const { NotificationService } = require('../../../../src/backend/services/NotificationService');
const { AuditLogService } = require('../../../../src/backend/services/AuditLogService');

describe('Content Claim Handler', () => {
  let mockContext: Context;
  let mockContentRepo: any;
  let mockUserRepo: any;
  let mockNotificationService: any;
  let mockAuditLogService: any;

  // Test UUIDs
  const validUserId = '550e8400-e29b-41d4-a716-446655440000';
  const validContentId = '550e8400-e29b-41d4-a716-446655440001';
  const otherUserId = '660e8400-e29b-41d4-a716-446655440002';
  const adminUserId = '770e8400-e29b-41d4-a716-446655440003';

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockReturnValue(mockPool);

    // Setup repository mocks
    mockContentRepo = {
      findById: jest.fn(),
      claimContent: jest.fn(),
    };
    mockUserRepo = {
      findById: jest.fn(),
    };
    mockNotificationService = {
      notifyAdminForReview: jest.fn().mockResolvedValue(undefined),
    };
    mockAuditLogService = {
      logContentClaim: jest.fn().mockResolvedValue(undefined),
    };

    ContentRepository.mockImplementation(() => mockContentRepo);
    UserRepository.mockImplementation(() => mockUserRepo);
    NotificationService.mockImplementation(() => mockNotificationService);
    AuditLogService.mockImplementation(() => mockAuditLogService);

    mockContext = {
      requestId: 'test-request-id',
      functionName: 'claim-content',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:claim-content',
      memoryLimitInMB: '128',
      awsRequestId: 'test-aws-request-id',
      logGroupName: '/aws/lambda/claim-content',
      logStreamName: '2025/09/29/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
      callbackWaitsForEmptyEventLoop: false,
    };
  });

  describe('POST /content/:id/claim - Basic Functionality', () => {
    it('should successfully claim content with exact name match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-123',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: {
            sourceIp: '192.168.1.1'
          }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john.doe@example.com',
        username: 'John Doe',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'John Doe',
        isClaimed: false,
        userId: null,
        title: 'Test Article',
        contentType: 'article'
      });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toMatch(/successfully/i); // Case-insensitive match
      expect(body.contentId).toBe(validContentId);
      expect(mockContentRepo.claimContent).toHaveBeenCalledWith(
        validContentId,
        validUserId,
        expect.objectContaining({
          requestId: 'req-123',
          sourceIp: '192.168.1.1'
        })
      );
    });

    it('should successfully claim with case-insensitive name match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-124',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john@example.com',
        username: 'john doe',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'John Doe',
        isClaimed: false,
        userId: null
      });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });

    it('should successfully claim with partial name match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-125',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john@example.com',
        username: 'John M. Doe',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'John Doe',
        isClaimed: false,
        userId: null
      });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });

    it('should successfully claim with email username match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-126',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john.doe@company.com',
        username: 'johndoe',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'john.doe',
        isClaimed: false,
        userId: null
      });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /content/:id/claim - Validation', () => {
    it('should return 400 if content ID is missing (bulk claim without contentIds)', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: null,
        body: JSON.stringify({}),
        requestContext: {
          authorizer: {
            userId: validUserId,
            isAdmin: false
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      // Returns 404 for missing path  or 400 for missing contentIds
      expect([400, 404]).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      // Can be either error message
      expect(body.error).toBeDefined();
    });

    it('should return 401 if user is not authenticated', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {} as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should return 400 if content does not exist', async () => {
      const nonexistentId = '880e8400-e29b-41d4-a716-446655440099';
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: nonexistentId },
        requestContext: {
          requestId: 'req-127',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'test@example.com',
        username: 'testuser',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue(null);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('not found');
    });

    it('should return 400 if content is already claimed by another user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-128',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'test@example.com',
        username: 'testuser',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        isClaimed: true,
        userId: otherUserId,
        originalAuthor: 'John Doe'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('already claimed');
    });

    it('should return 400 if author name does not match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-129',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'jane@example.com',
        username: 'Jane Smith',
        cognitoSub: 'cognito-123'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'John Doe',
        isClaimed: false,
        userId: null
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('mismatch');
    });
  });

  describe('POST /content/:id/claim - Admin Override', () => {
    it('should allow admin to claim any content with admin query parameter', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        queryStringParameters: { admin: 'true' },
        requestContext: {
          requestId: 'req-130',
          authorizer: {
            userId: adminUserId,
            isAdmin: true
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: adminUserId,
        email: 'admin@example.com',
        username: 'Admin User',
        cognitoSub: 'cognito-admin'
      });

      mockContentRepo.findById.mockResolvedValue({
        id: validContentId,
        originalAuthor: 'John Doe',
        isClaimed: false,
        userId: null
      });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });

    it('should reject admin override from non-admin user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        queryStringParameters: { admin: 'true' },
        requestContext: {
          requestId: 'req-131',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'user@example.com',
        username: 'Regular User',
        cognitoSub: 'cognito-user'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Admin privileges required');
    });
  });

  describe('POST /content/bulk-claim - Bulk Operations', () => {
    it('should successfully claim multiple content items', async () => {
      const contentId1 = '550e8400-e29b-41d4-a716-446655440011';
      const contentId2 = '550e8400-e29b-41d4-a716-446655440012';
      const contentId3 = '550e8400-e29b-41d4-a716-446655440013';

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: null,
        body: JSON.stringify({
          contentIds: [contentId1, contentId2, contentId3]
        }),
        requestContext: {
          requestId: 'req-132',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john@example.com',
        username: 'John Doe',
        cognitoSub: 'cognito-123'
      });

      // Mock all three content items
      mockContentRepo.findById
        .mockResolvedValueOnce({
          id: contentId1,
          originalAuthor: 'John Doe',
          isClaimed: false,
          userId: null
        })
        .mockResolvedValueOnce({
          id: contentId2,
          originalAuthor: 'John Doe',
          isClaimed: false,
          userId: null
        })
        .mockResolvedValueOnce({
          id: contentId3,
          originalAuthor: 'John Doe',
          isClaimed: false,
          userId: null
        });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(3);
      expect(body.summary.failure).toBe(0);
    });

    it('should handle partial success in bulk claim', async () => {
      const contentId1 = '550e8400-e29b-41d4-a716-446655440011';
      const contentId2 = '550e8400-e29b-41d4-a716-446655440012';
      const contentId3 = '550e8400-e29b-41d4-a716-446655440013';

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: null,
        body: JSON.stringify({
          contentIds: [contentId1, contentId2, contentId3]
        }),
        requestContext: {
          requestId: 'req-133',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({
        id: validUserId,
        email: 'john@example.com',
        username: 'John Doe',
        cognitoSub: 'cognito-123'
      });

      // First content - success
      mockContentRepo.findById
        .mockResolvedValueOnce({
          id: contentId1,
          originalAuthor: 'John Doe',
          isClaimed: false
        })
        // Second content - author mismatch
        .mockResolvedValueOnce({
          id: contentId2,
          originalAuthor: 'Jane Smith',
          isClaimed: false
        })
        // Third content - already claimed
        .mockResolvedValueOnce({
          id: contentId3,
          originalAuthor: 'John Doe',
          isClaimed: true,
          userId: otherUserId
        });

      mockContentRepo.claimContent.mockResolvedValue(true);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(207); // Multi-status
      const body = JSON.parse(response.body);
      expect(body.summary.success).toBe(1);
      expect(body.summary.failure).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: validContentId },
        requestContext: {
          requestId: 'req-134',
          authorizer: {
            userId: validUserId,
            isAdmin: false
          },
          identity: { sourceIp: '192.168.1.1' }
        } as any
      };

      mockUserRepo.findById.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle malformed request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: null,
        body: 'invalid json{',
        requestContext: {
          authorizer: {
            userId: validUserId,
            isAdmin: false
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      // Can return 400 for invalid JSON or 404 for missing path
      expect([400, 404]).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });
  });
});
