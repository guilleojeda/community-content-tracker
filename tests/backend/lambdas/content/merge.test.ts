/**
 * @test Content Merge API
 * @description Comprehensive tests for POST /content/merge endpoint
 * @coverage Target: >90%
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/merge';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';
import { AuditLogService } from '../../../../src/backend/services/AuditLogService';

// Mock dependencies
jest.mock('../../../../src/backend/repositories/ContentRepository');
jest.mock('../../../../src/backend/services/AuditLogService');

describe('Content Merge Handler', () => {
  let mockContentRepo: jest.Mocked<ContentRepository>;
  let mockAuditLog: jest.Mocked<AuditLogService>;
  let mockContext: Context;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContentRepo = new ContentRepository() as jest.Mocked<ContentRepository>;
    mockAuditLog = new AuditLogService() as jest.Mocked<AuditLogService>;

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
          sourceIds: ['content-1', 'content-2'],
          reason: 'Duplicate content from same author'
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

      const mockContent1 = {
        id: 'content-1',
        title: 'Introduction to AWS Lambda',
        original_author: 'John Doe',
        publish_date: new Date('2025-01-01'),
        urls: ['https://example.com/post1'],
        content_type: 'article',
        tags: ['aws', 'lambda'],
        view_count: 100,
        like_count: 10
      };

      const mockContent2 = {
        id: 'content-2',
        title: 'Getting Started with AWS Lambda',
        original_author: 'John Doe',
        publish_date: new Date('2025-02-01'),
        urls: ['https://example.com/post2'],
        content_type: 'article',
        tags: ['aws', 'serverless'],
        view_count: 50,
        like_count: 5
      };

      const mockMergedContent = {
        id: 'content-merged-123',
        title: 'Introduction to AWS Lambda',
        original_author: 'John Doe',
        publish_date: new Date('2025-01-01'), // Earliest date
        urls: ['https://example.com/post1', 'https://example.com/post2'],
        content_type: 'article',
        tags: ['aws', 'lambda', 'serverless'],
        view_count: 150,
        like_count: 15,
        merged_from: ['content-1', 'content-2'],
        merged_at: new Date(),
        merged_by: 'admin-123'
      };

      mockContentRepo.findByIds.mockResolvedValue([mockContent1, mockContent2]);
      mockContentRepo.mergeContent.mockResolvedValue(mockMergedContent);
      mockAuditLog.logContentMerge.mockResolvedValue(undefined);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.urls).toHaveLength(2);
      expect(body.data.publish_date).toBe('2025-01-01T00:00:00.000Z');
      expect(body.data.merged_from).toEqual(['content-1', 'content-2']);
      expect(mockAuditLog.logContentMerge).toHaveBeenCalled();
    });

    it('should merge multiple content items (>2)', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2', 'content-3', 'content-4'],
          reason: 'Multiple duplicates found'
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

      const mockContents = [
        {
          id: 'content-1',
          title: 'Title 1',
          publish_date: new Date('2025-03-01'),
          urls: ['https://example.com/1']
        },
        {
          id: 'content-2',
          title: 'Title 2',
          publish_date: new Date('2025-01-01'), // Earliest
          urls: ['https://example.com/2']
        },
        {
          id: 'content-3',
          title: 'Title 3',
          publish_date: new Date('2025-02-01'),
          urls: ['https://example.com/3']
        },
        {
          id: 'content-4',
          title: 'Title 4',
          publish_date: new Date('2025-04-01'),
          urls: ['https://example.com/4']
        }
      ];

      mockContentRepo.findByIds.mockResolvedValue(mockContents);
      mockContentRepo.mergeContent.mockResolvedValue({
        id: 'merged',
        publish_date: new Date('2025-01-01'),
        urls: mockContents.map(c => c.urls[0]),
        merged_from: ['content-1', 'content-2', 'content-3', 'content-4']
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.urls).toHaveLength(4);
      expect(body.data.merged_from).toHaveLength(4);
    });

    it('should preserve best metadata from all items', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      const mockContent1 = {
        id: 'content-1',
        title: 'Short Title',
        description: null,
        thumbnail_url: 'https://example.com/thumb1.jpg',
        tags: ['tag1']
      };

      const mockContent2 = {
        id: 'content-2',
        title: 'Much Longer and More Descriptive Title',
        description: 'Comprehensive description of the content',
        thumbnail_url: null,
        tags: ['tag1', 'tag2', 'tag3']
      };

      mockContentRepo.findByIds.mockResolvedValue([mockContent1, mockContent2]);
      mockContentRepo.mergeContent.mockResolvedValue({
        id: 'merged',
        title: 'Much Longer and More Descriptive Title', // Better title
        description: 'Comprehensive description of the content', // Has description
        thumbnail_url: 'https://example.com/thumb1.jpg', // Has thumbnail
        tags: ['tag1', 'tag2', 'tag3'] // More tags
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.title).toBe('Much Longer and More Descriptive Title');
      expect(body.data.description).toBeDefined();
      expect(body.data.thumbnail_url).toBeDefined();
      expect(body.data.tags).toHaveLength(3);
    });

    it('should combine URLs from all items without duplicates', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2', 'content-3']
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

      const mockContents = [
        {
          id: 'content-1',
          urls: ['https://example.com/post1', 'https://twitter.com/post1']
        },
        {
          id: 'content-2',
          urls: ['https://example.com/post1', 'https://linkedin.com/post2'] // Duplicate URL
        },
        {
          id: 'content-3',
          urls: ['https://medium.com/post3']
        }
      ];

      mockContentRepo.findByIds.mockResolvedValue(mockContents);
      mockContentRepo.mergeContent.mockResolvedValue({
        id: 'merged',
        urls: [
          'https://example.com/post1',
          'https://twitter.com/post1',
          'https://linkedin.com/post2',
          'https://medium.com/post3'
        ]
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.urls).toHaveLength(4);
      expect(new Set(body.data.urls).size).toBe(4); // All unique
    });
  });

  describe('POST /content/merge - Validation', () => {
    it('should require admin privileges', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
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

    it('should require at least 2 source IDs', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1']
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
      expect(body.error).toContain('At least 2 content items required');
    });

    it('should validate all source content exists', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2', 'nonexistent']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1' },
        { id: 'content-2' }
        // Missing 'nonexistent'
      ]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Some content items not found');
      expect(body.missing).toContain('nonexistent');
    });

    it('should prevent merging already merged content', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1', is_merged: false },
        { id: 'content-2', is_merged: true, merged_into: 'content-3' }
      ]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('already been merged');
    });

    it('should validate content types match', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1', content_type: 'article' },
        { id: 'content-2', content_type: 'video' }
      ]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Content types must match');
    });
  });

  describe('POST /content/merge - Audit Trail', () => {
    it('should create comprehensive audit trail', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2'],
          reason: 'Duplicate detection'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-123',
              email: 'admin@example.com'
            }
          },
          requestId: 'req-789',
          identity: {
            sourceIp: '192.168.1.1'
          }
        } as any
      };

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1' },
        { id: 'content-2' }
      ]);
      mockContentRepo.mergeContent.mockResolvedValue({
        id: 'merged',
        merged_from: ['content-1', 'content-2']
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockAuditLog.logContentMerge).toHaveBeenCalledWith({
        mergedContentId: 'merged',
        sourceIds: ['content-1', 'content-2'],
        reason: 'Duplicate detection',
        performedBy: 'admin-123',
        performedByEmail: 'admin@example.com',
        requestId: 'req-789',
        sourceIp: '192.168.1.1',
        timestamp: expect.any(Date)
      });
    });

    it('should track metadata preservation decisions', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1', title: 'Title A', view_count: 100 },
        { id: 'content-2', title: 'Title B', view_count: 200 }
      ]);
      mockContentRepo.mergeContent.mockResolvedValue({
        id: 'merged',
        title: 'Title B',
        view_count: 300
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(mockAuditLog.logContentMerge).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataDecisions: expect.objectContaining({
            title: { chosen: 'Title B', from: 'content-2' },
            view_count: { total: 300, combined: true }
          })
        })
      );
    });
  });

  describe('POST /content/:id/unmerge - Undo Capability', () => {
    it('should unmerge content within 30 days', async () => {
      const mergeDate = new Date();
      mergeDate.setDate(mergeDate.getDate() - 15); // 15 days ago

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merged-123/unmerge',
        pathParameters: { id: 'merged-123' },
        body: JSON.stringify({
          reason: 'Incorrect merge'
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

      const mockMergedContent = {
        id: 'merged-123',
        merged_from: ['content-1', 'content-2'],
        merged_at: mergeDate,
        merged_by: 'admin-456'
      };

      mockContentRepo.findById.mockResolvedValue(mockMergedContent);
      mockContentRepo.unmergeContent.mockResolvedValue({
        restored: ['content-1', 'content-2'],
        deleted: ['merged-123']
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.restored).toEqual(['content-1', 'content-2']);
      expect(mockContentRepo.unmergeContent).toHaveBeenCalledWith('merged-123', {
        reason: 'Incorrect merge',
        performedBy: 'admin-123'
      });
    });

    it('should reject unmerge after 30 days', async () => {
      const mergeDate = new Date();
      mergeDate.setDate(mergeDate.getDate() - 35); // 35 days ago

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merged-123/unmerge',
        pathParameters: { id: 'merged-123' },
        body: JSON.stringify({
          reason: 'Undo merge'
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

      const mockMergedContent = {
        id: 'merged-123',
        merged_at: mergeDate
      };

      mockContentRepo.findById.mockResolvedValue(mockMergedContent);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Cannot unmerge after 30 days');
    });

    it('should restore all original content items', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merged-123/unmerge',
        pathParameters: { id: 'merged-123' },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-123',
              'cognito:groups': ['Admin']
            }
          }
        } as any
      };

      const mockMergedContent = {
        id: 'merged-123',
        merged_from: ['content-1', 'content-2', 'content-3'],
        merged_at: new Date()
      };

      mockContentRepo.findById.mockResolvedValue(mockMergedContent);
      mockContentRepo.unmergeContent.mockResolvedValue({
        restored: ['content-1', 'content-2', 'content-3'],
        deleted: ['merged-123']
      });

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.restored).toHaveLength(3);
    });
  });

  describe('GET /content/:id/merge-history', () => {
    it('should return merge history for content', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/content/merged-123/merge-history',
        pathParameters: { id: 'merged-123' }
      };

      const mockHistory = {
        contentId: 'merged-123',
        mergedFrom: ['content-1', 'content-2'],
        mergedAt: new Date('2025-09-01'),
        mergedBy: 'admin-123',
        mergeReason: 'Duplicate content',
        canUnmerge: true,
        unmergeDeadline: new Date('2025-10-01')
      };

      mockContentRepo.getMergeHistory.mockResolvedValue(mockHistory);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.mergedFrom).toEqual(['content-1', 'content-2']);
      expect(body.data.canUnmerge).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Internal server error');
    });

    it('should rollback on merge failure', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1' },
        { id: 'content-2' }
      ]);
      mockContentRepo.mergeContent.mockRejectedValue(
        new Error('Transaction failed')
      );

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(500);
      // Verify rollback was attempted
      expect(mockContentRepo.rollbackMerge).toHaveBeenCalled();
    });
  });

  describe('Concurrent Merge Prevention', () => {
    it('should prevent concurrent merges of same content', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/content/merge',
        body: JSON.stringify({
          sourceIds: ['content-1', 'content-2']
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

      mockContentRepo.findByIds.mockResolvedValue([
        { id: 'content-1', merge_lock: 'other-request' },
        { id: 'content-2' }
      ]);

      const response = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('merge in progress');
    });
  });
});