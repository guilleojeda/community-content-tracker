/**
 * @test Badge Management API
 * @description Comprehensive tests for badge management endpoints
 * @coverage Target: >90%
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/admin/badges';
import { BadgeRepository } from '../../../../src/backend/repositories/BadgeRepository';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { AuditLogService } from '../../../../src/backend/services/AuditLogService';

// Mock dependencies
jest.mock('../../../../src/backend/repositories/BadgeRepository');
jest.mock('../../../../src/backend/repositories/UserRepository');
jest.mock('../../../../src/backend/services/AuditLogService');

describe('Badge Management Handler', () => {
  let mockBadgeRepo: jest.Mocked<BadgeRepository>;
  let mockUserRepo: jest.Mocked<UserRepository>;
  let mockAuditLog: jest.Mocked<AuditLogService>;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBadgeRepo = new BadgeRepository() as jest.Mocked<BadgeRepository>;
    mockUserRepo = new UserRepository() as jest.Mocked<UserRepository>;
    mockAuditLog = new AuditLogService() as jest.Mocked<AuditLogService>;

    mockContext = {
      requestId: 'test-request-id',
      functionName: 'badge-management',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:badge-management',
      memoryLimitInMB: '128',
      awsRequestId: 'test-aws-request-id',
      logGroupName: '/aws/lambda/badge-management',
      logStreamName: '2025/09/29/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
      callbackWaitsForEmptyEventLoop: false,
    };
  });

  describe('POST /admin/badges - Grant Badge', () => {
    it('should successfully grant badge to user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero',
          reason: 'Outstanding contributions',
          metadata: {
            contributionCount: 50
          }
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockUser = {
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com'
      };

      const mockBadge = {
        id: 'badge-789',
        user_id: 'user-123',
        badge_type: 'community-hero',
        granted_at: new Date(),
        granted_by: 'admin-456',
        reason: 'Outstanding contributions',
        metadata: { contributionCount: 50 }
      };

      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockBadgeRepo.grantBadge.mockResolvedValue(mockBadge);
      mockAuditLog.logBadgeGrant.mockResolvedValue(undefined);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.badge_type).toBe('community-hero');
      expect(mockBadgeRepo.grantBadge).toHaveBeenCalledWith({
        userId: 'user-123',
        badgeType: 'community-hero',
        reason: 'Outstanding contributions',
        grantedBy: 'admin-456',
        metadata: { contributionCount: 50 }
      });
      expect(mockAuditLog.logBadgeGrant).toHaveBeenCalled();
    });

    it('should reject if user is not admin', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-789'
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

    it('should validate badge type', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'invalid-badge-type'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid badge type');
    });

    it('should prevent duplicate badge grants', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({ id: 'user-123' });
      mockBadgeRepo.grantBadge.mockRejectedValue(
        new Error('User already has this badge')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already has this badge');
    });

    it('should return 404 if user does not exist', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'nonexistent',
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue(null);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('User not found');
    });
  });

  describe('DELETE /admin/badges - Revoke Badge', () => {
    it('should successfully revoke badge from user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero',
          reason: 'Policy violation'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockBadgeRepo.revokeBadge.mockResolvedValue({
        success: true,
        revokedAt: new Date()
      });
      mockAuditLog.logBadgeRevoke.mockResolvedValue(undefined);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(mockBadgeRepo.revokeBadge).toHaveBeenCalledWith({
        userId: 'user-123',
        badgeType: 'community-hero',
        reason: 'Policy violation',
        revokedBy: 'admin-456'
      });
      expect(mockAuditLog.logBadgeRevoke).toHaveBeenCalled();
    });

    it('should require reason for revocation', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero'
          // Missing reason
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Reason is required');
    });

    it('should return 404 if badge not found', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero',
          reason: 'Test'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockBadgeRepo.revokeBadge.mockResolvedValue({
        success: false,
        error: 'Badge not found'
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Badge not found');
    });
  });

  describe('PUT /admin/users/:id/aws-employee - AWS Employee Status', () => {
    it('should mark user as AWS employee', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: '/admin/users/user-123/aws-employee',
        pathParameters: { id: 'user-123' },
        body: JSON.stringify({
          isAwsEmployee: true,
          verificationMethod: 'email-domain',
          metadata: {
            email: 'john@amazon.com'
          }
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockUser = {
        id: 'user-123',
        email: 'john@amazon.com'
      };

      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockUserRepo.updateAwsEmployeeStatus.mockResolvedValue({
        ...mockUser,
        is_aws_employee: true,
        aws_employee_verified_at: new Date(),
        aws_employee_verified_by: 'admin-456'
      });
      mockAuditLog.logAwsEmployeeStatusChange.mockResolvedValue(undefined);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.is_aws_employee).toBe(true);
      expect(mockAuditLog.logAwsEmployeeStatusChange).toHaveBeenCalled();
    });

    it('should remove AWS employee status', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: '/admin/users/user-123/aws-employee',
        pathParameters: { id: 'user-123' },
        body: JSON.stringify({
          isAwsEmployee: false,
          reason: 'No longer employed'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockUserRepo.findById.mockResolvedValue({ id: 'user-123' });
      mockUserRepo.updateAwsEmployeeStatus.mockResolvedValue({
        id: 'user-123',
        is_aws_employee: false
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.is_aws_employee).toBe(false);
    });

    it('should validate email domain for AWS employees', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: '/admin/users/user-123/aws-employee',
        pathParameters: { id: 'user-123' },
        body: JSON.stringify({
          isAwsEmployee: true,
          verificationMethod: 'email-domain'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockUser = {
        id: 'user-123',
        email: 'john@example.com' // Not AWS domain
      };

      mockUserRepo.findById.mockResolvedValue(mockUser);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Email domain does not match AWS');
    });
  });

  describe('GET /users/:id/badges - Public Badge Listing', () => {
    it('should return all active badges for user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/users/user-123/badges',
        pathParameters: { id: 'user-123' }
      };

      const mockBadges = [
        {
          id: 'badge-1',
          badge_type: 'community-hero',
          granted_at: new Date('2025-01-01'),
          is_active: true
        },
        {
          id: 'badge-2',
          badge_type: 'aws-employee',
          granted_at: new Date('2025-02-01'),
          is_active: true
        }
      ];

      mockBadgeRepo.findByUserId.mockResolvedValue(mockBadges);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].badge_type).toBe('community-hero');
    });

    it('should filter out revoked badges', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/users/user-123/badges',
        pathParameters: { id: 'user-123' }
      };

      const mockBadges = [
        {
          id: 'badge-1',
          badge_type: 'community-hero',
          is_active: true
        },
        {
          id: 'badge-2',
          badge_type: 'old-badge',
          is_active: false,
          revoked_at: new Date()
        }
      ];

      mockBadgeRepo.findByUserId.mockResolvedValue(mockBadges);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].badge_type).toBe('community-hero');
    });

    it('should return empty array if user has no badges', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/users/user-123/badges',
        pathParameters: { id: 'user-123' }
      };

      mockBadgeRepo.findByUserId.mockResolvedValue([]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /admin/badges/history/:userId - Badge History', () => {
    it('should return complete badge history including revoked', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/admin/badges/history/user-123',
        pathParameters: { userId: 'user-123' },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockHistory = [
        {
          id: 'badge-1',
          badge_type: 'community-hero',
          granted_at: new Date('2025-01-01'),
          granted_by: 'admin-123',
          is_active: true
        },
        {
          id: 'badge-2',
          badge_type: 'old-badge',
          granted_at: new Date('2024-01-01'),
          granted_by: 'admin-123',
          revoked_at: new Date('2025-06-01'),
          revoked_by: 'admin-456',
          revoke_reason: 'Policy change',
          is_active: false
        }
      ];

      mockBadgeRepo.getBadgeHistory.mockResolvedValue(mockHistory);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
      expect(body.data[1].revoked_at).toBeDefined();
      expect(body.data[1].revoke_reason).toBe('Policy change');
    });
  });

  describe('POST /admin/badges/bulk - Bulk Badge Operations', () => {
    it('should grant badges to multiple users', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges/bulk',
        body: JSON.stringify({
          operation: 'grant',
          userIds: ['user-1', 'user-2', 'user-3'],
          badgeType: 'community-hero',
          reason: 'Batch recognition'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockBadgeRepo.bulkGrantBadges.mockResolvedValue({
        successful: ['user-1', 'user-2', 'user-3'],
        failed: []
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.successful).toHaveLength(3);
      expect(body.data.failed).toHaveLength(0);
    });

    it('should handle partial success in bulk operations', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges/bulk',
        body: JSON.stringify({
          operation: 'grant',
          userIds: ['user-1', 'user-2', 'user-3'],
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockBadgeRepo.bulkGrantBadges.mockResolvedValue({
        successful: ['user-1', 'user-3'],
        failed: [
          { userId: 'user-2', reason: 'User already has badge' }
        ]
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(207);
      const body = JSON.parse(response.body);
      expect(body.data.successful).toHaveLength(2);
      expect(body.data.failed).toHaveLength(1);
    });

    it('should limit bulk operations to 100 users', async () => {
      const userIds = Array.from({ length: 150 }, (_, i) => `user-${i}`);
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges/bulk',
        body: JSON.stringify({
          operation: 'grant',
          userIds,
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Maximum 100 users');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: 'user-123',
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      mockUserRepo.findById.mockRejectedValue(new Error('Database connection failed'));

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Internal server error');
    });

    it('should validate request body schema', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          // Missing required fields
          badgeType: 'community-hero'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-456',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('userId is required');
    });
  });

  describe('Badge Types', () => {
    it('should support all defined badge types', async () => {
      const badgeTypes = [
        'community-hero',
        'aws-employee',
        'content-creator',
        'reviewer',
        'early-adopter'
      ];

      for (const badgeType of badgeTypes) {
        const event: Partial<APIGatewayProxyEvent> = {
          httpMethod: 'POST',
          path: '/admin/badges',
          body: JSON.stringify({
            userId: 'user-123',
            badgeType
          }),
          requestContext: {
            authorizer: {
              claims: {
                sub: 'admin-456',
                'cognito:groups': ['Admin']
              }
            }
          } as any
        };

        mockUserRepo.findById.mockResolvedValue({ id: 'user-123' });
        mockBadgeRepo.grantBadge.mockResolvedValue({
          id: 'badge-1',
          badge_type: badgeType,
          user_id: 'user-123'
        });

        const response = await handler(event as APIGatewayProxyEvent, mockContext);

        expect(response.statusCode).toBe(201);
      }
    });
  });
});