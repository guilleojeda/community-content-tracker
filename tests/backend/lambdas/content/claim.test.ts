/**
 * @test Content Claiming API
 * @description Comprehensive tests for POST /content/:id/claim endpoint
 * @coverage Target: >90%
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/claim';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { NotificationService } from '../../../../src/backend/services/NotificationService';

// Mock dependencies
jest.mock('../../../../src/backend/repositories/ContentRepository');
jest.mock('../../../../src/backend/repositories/UserRepository');
jest.mock('../../../../src/backend/services/NotificationService');

describe('Content Claim Handler', () => {
  let mockContentRepo: jest.Mocked<ContentRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;
  let mockNotificationService: jest.Mocked<NotificationService>;
  let mockContext: Context;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock implementations
    mockContentRepo = new ContentRepository() as jest.Mocked<ContentRepository>;
    mockUserRepo = new UserRepository() as jest.Mocked<UserRepository>;
    mockNotificationService = new NotificationService() as jest.Mocked<NotificationService>;

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
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          claimReason: 'I am the original author'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              email: 'john.doe@example.com',
              name: 'John Doe'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false,
        user_id: null,
        title: 'Test Article',
        content_type: 'article'
      };

      const mockUser = {
        id: 'user-456',
        email: 'john.doe@example.com',
        name: 'John Doe',
        cognito_sub: 'user-456'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456',
        claimed_at: new Date()
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.is_claimed).toBe(true);
      expect(body.data.user_id).toBe('user-456');
      expect(mockContentRepo.claimContent).toHaveBeenCalledWith(
        'content-123',
        'user-456',
        expect.any(Object)
      );
    });

    it('should successfully claim with case-insensitive name match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'john doe'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      const mockUser = {
        id: 'user-456',
        name: 'john doe'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockContentRepo.claimContent).toHaveBeenCalled();
    });

    it('should successfully claim with partial name match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John M. Doe'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      const mockUser = {
        id: 'user-456',
        name: 'John M. Doe'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });

    it('should successfully claim with email domain match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              email: 'john.doe@company.com'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'john.doe@company.com',
        is_claimed: false
      };

      const mockUser = {
        id: 'user-456',
        email: 'john.doe@company.com'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /content/:id/claim - Validation', () => {
    it('should return 400 if content ID is missing', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: null,
        body: JSON.stringify({ userId: 'user-456' })
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Content ID is required');
    });

    it('should return 401 if user is not authenticated', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {} as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Unauthorized');
    });

    it('should return 404 if content does not exist', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'nonexistent' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      mockContentRepo.findById.mockResolvedValue(null);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Content not found');
    });

    it('should return 400 if content is already claimed', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        is_claimed: true,
        user_id: 'other-user',
        original_author: 'John Doe'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already claimed');
    });

    it('should return 403 if author name does not match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'Jane Smith'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      const mockUser = {
        id: 'user-456',
        name: 'Jane Smith'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('does not match');
    });
  });

  describe('POST /content/:id/claim - Admin Override', () => {
    it('should allow admin to claim any content', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          adminOverride: true,
          overrideReason: 'Verified via external source'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-123',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      const mockUser = {
        id: 'user-456',
        name: 'Jane Smith' // Different name
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockContentRepo.claimContent).toHaveBeenCalledWith(
        'content-123',
        'user-456',
        expect.objectContaining({
          adminOverride: true,
          overrideReason: 'Verified via external source',
          overrideBy: 'admin-123'
        })
      );
    });

    it('should reject admin override from non-admin user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          adminOverride: true
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456'
              // No admin group
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Admin privileges required');
    });

    it('should require override reason for admin claims', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          adminOverride: true
          // Missing overrideReason
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-123',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Override reason is required');
    });
  });

  describe('POST /content/bulk-claim - Bulk Operations', () => {
    it('should successfully claim multiple content items', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/bulk-claim',
        body: JSON.stringify({
          contentIds: ['content-1', 'content-2', 'content-3'],
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John Doe'
            }
          }
        } as any
      };

      const mockContents = [
        { id: 'content-1', original_author: 'John Doe', is_claimed: false },
        { id: 'content-2', original_author: 'John Doe', is_claimed: false },
        { id: 'content-3', original_author: 'John Doe', is_claimed: false }
      ];

      mockContentRepo.findByIds.mockResolvedValue(mockContents);
      mockContentRepo.bulkClaimContent.mockResolvedValue({
        successful: ['content-1', 'content-2', 'content-3'],
        failed: []
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.successful).toHaveLength(3);
      expect(body.data.failed).toHaveLength(0);
    });

    it('should handle partial success in bulk claim', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/bulk-claim',
        body: JSON.stringify({
          contentIds: ['content-1', 'content-2', 'content-3'],
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John Doe'
            }
          }
        } as any
      };

      const mockContents = [
        { id: 'content-1', original_author: 'John Doe', is_claimed: false },
        { id: 'content-2', original_author: 'Jane Smith', is_claimed: false },
        { id: 'content-3', original_author: 'John Doe', is_claimed: true }
      ];

      mockContentRepo.findByIds.mockResolvedValue(mockContents);
      mockContentRepo.bulkClaimContent.mockResolvedValue({
        successful: ['content-1'],
        failed: [
          { id: 'content-2', reason: 'Author mismatch' },
          { id: 'content-3', reason: 'Already claimed' }
        ]
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(207); // Multi-status
      const body = JSON.parse(response.body);
      expect(body.data.successful).toHaveLength(1);
      expect(body.data.failed).toHaveLength(2);
    });

    it('should limit bulk claim to maximum 100 items', async () => {
      const contentIds = Array.from({ length: 150 }, (_, i) => `content-${i}`);
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/bulk-claim',
        body: JSON.stringify({
          contentIds,
          userId: 'user-456'
        }),
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Maximum 100 items');
    });
  });

  describe('POST /content/:id/claim - Notifications', () => {
    it('should send notification to admin after successful claim', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          notifyAdmin: true
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John Doe',
              email: 'john@example.com'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false,
        title: 'Test Article'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });
      mockNotificationService.notifyAdminClaimReview.mockResolvedValue(undefined);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockNotificationService.notifyAdminClaimReview).toHaveBeenCalledWith({
        contentId: 'content-123',
        contentTitle: 'Test Article',
        userId: 'user-456',
        userName: 'John Doe',
        userEmail: 'john@example.com',
        claimedAt: expect.any(Date)
      });
    });

    it('should not fail if notification service fails', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          notifyAdmin: true
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John Doe'
            }
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });
      mockNotificationService.notifyAdminClaimReview.mockRejectedValue(
        new Error('Email service unavailable')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      // Claim should succeed even if notification fails
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      mockContentRepo.findById.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Internal server error');
    });

    it('should handle malformed request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: 'invalid json{',
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid request body');
    });

    it('should handle timeout gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({ userId: 'user-456' }),
        requestContext: {
          authorizer: {
            claims: { sub: 'user-456' }
          }
        } as any
      };

      mockContentRepo.findById.mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 60000))
      );

      // Mock context with short timeout
      mockContext.getRemainingTimeInMillis = () => 100;

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(504);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Request timeout');
    });
  });

  describe('Audit Trail', () => {
    it('should log claim attempt with all details', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: { id: 'content-123' },
        body: JSON.stringify({
          userId: 'user-456',
          claimReason: 'Original author verification'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-456',
              name: 'John Doe'
            }
          },
          requestId: 'req-789',
          identity: {
            sourceIp: '192.168.1.1'
          }
        } as any
      };

      const mockContent = {
        id: 'content-123',
        original_author: 'John Doe',
        is_claimed: false
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);
      mockContentRepo.claimContent.mockResolvedValue({
        ...mockContent,
        is_claimed: true,
        user_id: 'user-456'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockContentRepo.claimContent).toHaveBeenCalledWith(
        'content-123',
        'user-456',
        expect.objectContaining({
          claimReason: 'Original author verification',
          requestId: 'req-789',
          sourceIp: '192.168.1.1'
        })
      );
    });
  });

  describe('GET /content/:id/claim-status', () => {
    it('should return claim status for content', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        pathParameters: { id: 'content-123' }
      };

      const mockContent = {
        id: 'content-123',
        is_claimed: true,
        user_id: 'user-456',
        claimed_at: new Date('2025-09-29'),
        original_author: 'John Doe'
      };

      mockContentRepo.findById.mockResolvedValue(mockContent);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.is_claimed).toBe(true);
      expect(body.data.claimed_at).toBe('2025-09-29T00:00:00.000Z');
    });
  });
});