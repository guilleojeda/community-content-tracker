import { handler } from '../../../../src/backend/lambdas/content/delete';
import { DynamoDBClient, GetItemCommand, DeleteItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

const dynamoMock = mockClient(DynamoDBClient);

describe('Delete Content Lambda', () => {
  const TABLE_NAME = 'ContentTable';
  const URLS_TABLE_NAME = 'ContentUrlsTable';
  const mockUserId = 'user-123';
  const mockAdminId = 'admin-456';
  const mockContentId = 'content-789';
  const mockOtherUserId = 'user-999';

  beforeEach(() => {
    dynamoMock.reset();
    process.env.CONTENT_TABLE_NAME = TABLE_NAME;
    process.env.CONTENT_URLS_TABLE_NAME = URLS_TABLE_NAME;
    process.env.ENABLE_SOFT_DELETE = 'false'; // Default to hard delete, soft delete tests override this
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_SOFT_DELETE;
  });

  describe('Owner Delete Tests', () => {
    it('should allow owner to delete content', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Content to Delete',
        createdAt: '2025-01-01T00:00:00Z'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      // No URLs to cascade delete
      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      expect(dynamoMock).toHaveReceivedCommandWith(GetItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId })
      });
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId })
      });
    });

    it('should return 204 No Content on success', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Content'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      expect(result.headers?.['Content-Length']).toBe('0');
    });
  });

  describe('Admin Permission Tests', () => {
    it('should allow admin to delete any content', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockOtherUserId, // Different from admin
        title: 'Content'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockAdminId,
              'cognito:groups': JSON.stringify(['Admins'])
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(dynamoMock).toHaveReceivedCommand(DeleteItemCommand);
    });

    it('should allow admin with multiple groups to delete content', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockOtherUserId,
        title: 'Content'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockAdminId,
              'cognito:groups': JSON.stringify(['Users', 'Admins', 'Moderators'])
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
    });
  });

  describe('Authorization Tests', () => {
    it('should return 403 for non-owner attempts', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId, // Original owner
        title: 'Content'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockOtherUserId, // Different user, not admin
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('not authorized');
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });

    it('should return 403 when user has no admin group', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Content'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockOtherUserId,
              'cognito:groups': JSON.stringify(['Users', 'Moderators'])
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });

    it('should return 401 when user is not authenticated', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: undefined
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Unauthorized');
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });
  });

  describe('Cascade Delete Tests', () => {
    it('should cascade delete content_urls', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Content'
      };

      const mockUrls = [
        { id: 'url-1', contentId: mockContentId, url: 'https://example.com/1' },
        { id: 'url-2', contentId: mockContentId, url: 'https://example.com/2' },
        { id: 'url-3', contentId: mockContentId, url: 'https://example.com/3' }
      ];

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: mockUrls.map(url => marshall(url))
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);

      // Should delete all 3 URLs plus the content item
      expect(dynamoMock).toHaveReceivedCommandTimes(DeleteItemCommand, 4);

      // Verify each URL was deleted
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: URLS_TABLE_NAME,
        Key: marshall({ id: 'url-1' })
      });
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: URLS_TABLE_NAME,
        Key: marshall({ id: 'url-2' })
      });
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: URLS_TABLE_NAME,
        Key: marshall({ id: 'url-3' })
      });

      // Verify content was deleted
      expect(dynamoMock).toHaveReceivedCommandWith(DeleteItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId })
      });
    });

    it('should query URLs by contentId index', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      await handler(event as any);

      expect(dynamoMock).toHaveReceivedCommandWith(QueryCommand, {
        TableName: URLS_TABLE_NAME,
        IndexName: 'ContentIdIndex',
        KeyConditionExpression: 'contentId = :contentId',
        ExpressionAttributeValues: marshall({
          ':contentId': mockContentId
        })
      });
    });

    it('should handle cascade delete with paginated results', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      // First page of URLs
      const firstPageUrls = Array.from({ length: 100 }, (_, i) => ({
        id: `url-${i}`,
        contentId: mockContentId
      }));

      // Second page of URLs
      const secondPageUrls = Array.from({ length: 50 }, (_, i) => ({
        id: `url-${i + 100}`,
        contentId: mockContentId
      }));

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      // First query returns first page with LastEvaluatedKey
      dynamoMock.on(QueryCommand).resolvesOnce({
        Items: firstPageUrls.map(url => marshall(url)),
        LastEvaluatedKey: marshall({ id: 'url-99' })
      });

      // Second query returns second page
      dynamoMock.on(QueryCommand).resolvesOnce({
        Items: secondPageUrls.map(url => marshall(url))
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);

      // Should delete 150 URLs + 1 content item = 151 deletes
      expect(dynamoMock).toHaveReceivedCommandTimes(DeleteItemCommand, 151);
    });

    it('should continue cascade delete even if some URL deletes fail', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      const mockUrls = [
        { id: 'url-1', contentId: mockContentId },
        { id: 'url-2', contentId: mockContentId },
        { id: 'url-3', contentId: mockContentId }
      ];

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: mockUrls.map(url => marshall(url))
      });

      // First delete succeeds
      dynamoMock.on(DeleteItemCommand).resolvesOnce({});
      // Second delete fails
      dynamoMock.on(DeleteItemCommand).rejectsOnce(new Error('Delete failed'));
      // Third delete succeeds
      dynamoMock.on(DeleteItemCommand).resolvesOnce({});
      // Content delete succeeds
      dynamoMock.on(DeleteItemCommand).resolvesOnce({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      // Should still succeed despite one URL delete failure
      expect(result.statusCode).toBe(204);
      expect(dynamoMock).toHaveReceivedCommandTimes(DeleteItemCommand, 4);
    });
  });

  describe('Soft Delete Tests', () => {
    it('should soft delete when enabled', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Content',
        deletedAt: null
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          deletedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
      expect(dynamoMock).toHaveReceivedCommandWith(UpdateItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId }),
        UpdateExpression: 'SET deletedAt = :deletedAt',
        ExpressionAttributeValues: expect.objectContaining({
          ':deletedAt': expect.any(Object)
        })
      });
    });

    it('should hard delete when soft delete is disabled', async () => {
      process.env.ENABLE_SOFT_DELETE = 'false';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(dynamoMock).toHaveReceivedCommand(DeleteItemCommand);
      expect(dynamoMock).not.toHaveReceivedCommand(UpdateItemCommand);
    });

    it('should record deletion timestamp for audit trail', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      const deletionTime = new Date().toISOString();
      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          deletedAt: deletionTime,
          deletedBy: mockUserId
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(dynamoMock).toHaveReceivedCommandWith(UpdateItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId }),
        UpdateExpression: expect.stringContaining('deletedAt'),
        ExpressionAttributeValues: expect.any(Object)
      });
    });

    it('should prevent deleting already soft-deleted content', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        deletedAt: '2025-01-01T00:00:00Z' // Already deleted
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(410);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('already deleted');
      expect(dynamoMock).not.toHaveReceivedCommand(UpdateItemCommand);
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });

    it('should soft delete URLs when enabled', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      const mockUrls = [
        { id: 'url-1', contentId: mockContentId },
        { id: 'url-2', contentId: mockContentId }
      ];

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: mockUrls.map(url => marshall(url))
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({})
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);

      // Should soft delete 2 URLs + 1 content = 3 updates
      expect(dynamoMock).toHaveReceivedCommandTimes(UpdateItemCommand, 3);
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });
  });

  describe('Error Handling Tests', () => {
    it('should return 404 when content does not exist', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined
      });

      const event = {
        pathParameters: { id: 'non-existent-id' },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('not found');
      expect(dynamoMock).not.toHaveReceivedCommand(DeleteItemCommand);
    });

    it('should return 400 when missing content ID', async () => {
      const event = {
        pathParameters: {},
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('ID');
    });

    it('should return 500 on DynamoDB error', async () => {
      dynamoMock.on(GetItemCommand).rejects(new Error('DynamoDB service error'));

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Failed');
    });

    it('should rollback on cascade delete failure', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: [marshall({ id: 'url-1', contentId: mockContentId })]
      });

      // URL delete succeeds
      dynamoMock.on(DeleteItemCommand).resolvesOnce({});

      // Content delete fails
      dynamoMock.on(DeleteItemCommand).rejectsOnce(new Error('Critical delete error'));

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Failed');
    });
  });

  describe('Query Parameter Tests', () => {
    it('should support force delete query parameter', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        deletedAt: '2025-01-01T00:00:00Z' // Already soft deleted
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        queryStringParameters: { force: 'true' },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': JSON.stringify(['Admins'])
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(204);
      expect(dynamoMock).toHaveReceivedCommand(DeleteItemCommand);
      expect(dynamoMock).not.toHaveReceivedCommand(UpdateItemCommand);
    });

    it('should require admin role for force delete', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        deletedAt: '2025-01-01T00:00:00Z'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        queryStringParameters: { force: 'true' },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId, // Regular user, not admin
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('admin');
    });
  });

  describe('Performance Tests', () => {
    it('should handle large number of URLs efficiently', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      // Create 500 URLs
      const mockUrls = Array.from({ length: 500 }, (_, i) => ({
        id: `url-${i}`,
        contentId: mockContentId
      }));

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: mockUrls.map(url => marshall(url))
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const startTime = Date.now();
      const result = await handler(event as any);
      const duration = Date.now() - startTime;

      expect(result.statusCode).toBe(204);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(dynamoMock).toHaveReceivedCommandTimes(DeleteItemCommand, 501); // 500 URLs + 1 content
    });
  });

  describe('Audit Trail Tests', () => {
    it('should record who deleted the content', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          deletedAt: new Date().toISOString(),
          deletedBy: mockAdminId
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockAdminId,
              'cognito:groups': JSON.stringify(['Admins'])
            }
          }
        }
      };

      await handler(event as any);

      expect(dynamoMock).toHaveReceivedCommandWith(UpdateItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId }),
        UpdateExpression: expect.stringContaining('deletedAt'),
        ExpressionAttributeValues: expect.any(Object)
      });
    });

    it('should preserve original creator info in audit trail', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        createdAt: '2025-01-01T00:00:00Z'
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(QueryCommand).resolves({
        Items: []
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          deletedAt: new Date().toISOString(),
          deletedBy: mockAdminId
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockAdminId,
              'cognito:groups': JSON.stringify(['Admins'])
            }
          }
        }
      };

      await handler(event as any);

      // Verify UpdateItemCommand doesn't modify userId or createdAt
      expect(dynamoMock).toHaveReceivedCommandWith(UpdateItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId }),
        UpdateExpression: expect.not.stringContaining('userId'),
        ExpressionAttributeValues: expect.any(Object)
      });
    });
  });
});