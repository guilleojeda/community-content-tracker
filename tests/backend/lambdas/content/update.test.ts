import { handler } from '../../../../src/backend/lambdas/content/update';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

const dynamoMock = mockClient(DynamoDBClient);

describe('Update Content Lambda', () => {
  const TABLE_NAME = 'ContentTable';
  const mockUserId = 'user-123';
  const mockAdminId = 'admin-456';
  const mockContentId = 'content-789';
  const mockOtherUserId = 'user-999';

  beforeEach(() => {
    dynamoMock.reset();
    process.env.CONTENT_TABLE_NAME = TABLE_NAME;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Owner Update Tests', () => {
    it('should allow owner to update content successfully', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Old Title',
        description: 'Old Description',
        visibility: 'public',
        tags: ['old-tag'],
        version: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      };

      const updateBody = {
        title: 'Updated Title',
        description: 'Updated Description',
        visibility: 'private',
        tags: ['new-tag', 'another-tag'],
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          ...updateBody,
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify(updateBody),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Updated Title');
      expect(body.description).toBe('Updated Description');
      expect(body.visibility).toBe('private');
      expect(body.tags).toEqual(['new-tag', 'another-tag']);
      expect(body.version).toBe(2);
      expect(body.updatedAt).toBeDefined();
      expect(dynamoMock).toHaveReceivedCommandWith(GetItemCommand, {
        TableName: TABLE_NAME,
        Key: marshall({ id: mockContentId })
      });
    });

    it('should update only specific fields when provided', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Original Title',
        description: 'Original Description',
        visibility: 'public',
        tags: ['tag1', 'tag2'],
        version: 1
      };

      const updateBody = {
        description: 'Only Description Updated',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          description: 'Only Description Updated',
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify(updateBody),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Original Title'); // Unchanged
      expect(body.description).toBe('Only Description Updated'); // Changed
      expect(body.visibility).toBe('public'); // Unchanged
    });

    it('should track updated timestamp on every update', async () => {
      const oldTimestamp = '2025-01-01T00:00:00Z';
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        updatedAt: oldTimestamp,
        version: 1
      };

      const updateBody = {
        title: 'New Title',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const newTimestamp = new Date().toISOString();
      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          title: 'New Title',
          version: 2,
          updatedAt: newTimestamp
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify(updateBody),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.updatedAt).toBeDefined();
      expect(body.updatedAt).not.toBe(oldTimestamp);
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(
        new Date(oldTimestamp).getTime()
      );
    });
  });

  describe('Admin Permission Tests', () => {
    it('should allow admin to update any content', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockOtherUserId, // Different from admin
        title: 'Original Title',
        version: 1
      };

      const updateBody = {
        title: 'Admin Updated Title',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          title: 'Admin Updated Title',
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify(updateBody),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Admin Updated Title');
    });

    it('should allow admin with multiple groups to update content', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockOtherUserId,
        title: 'Title',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Updated', version: 1 }),
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

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Authorization Tests', () => {
    it('should return 403 for non-owner attempts', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId, // Original owner
        title: 'Title',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Unauthorized Update', version: 1 }),
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
      expect(dynamoMock).not.toHaveReceivedCommand(UpdateItemCommand);
    });

    it('should return 403 when user has no groups', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Update', version: 1 }),
        requestContext: {
          authorizer: {
            claims: {
              sub: mockOtherUserId,
              'cognito:groups': undefined
            }
          }
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
    });
  });

  describe('Visibility Change Tests', () => {
    it('should update visibility from public to private', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        visibility: 'public',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          visibility: 'private',
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ visibility: 'private', version: 1 }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.visibility).toBe('private');
    });

    it('should update visibility from private to public', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        visibility: 'private',
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          visibility: 'public',
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ visibility: 'public', version: 1 }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.visibility).toBe('public');
    });

    it('should reject invalid visibility values', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ visibility: 'invalid-value', version: 1 }),
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
      expect(body.error).toContain('visibility');
    });
  });

  describe('Tags Modification Tests', () => {
    it('should update tags array', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        tags: ['old-tag1', 'old-tag2'],
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          tags: ['new-tag1', 'new-tag2', 'new-tag3'],
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          tags: ['new-tag1', 'new-tag2', 'new-tag3'],
          version: 1
        }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.tags).toEqual(['new-tag1', 'new-tag2', 'new-tag3']);
      expect(body.tags).not.toContain('old-tag1');
    });

    it('should allow empty tags array', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        tags: ['tag1', 'tag2'],
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          tags: [],
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ tags: [], version: 1 }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.tags).toEqual([]);
    });

    it('should validate tags are strings', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          tags: ['valid', 123, { invalid: true }],
          version: 1
        }),
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
      expect(body.error).toContain('tags');
    });

    it('should enforce maximum number of tags', async () => {
      const tooManyTags = Array.from({ length: 51 }, (_, i) => `tag-${i}`);

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ tags: tooManyTags, version: 1 }),
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
      expect(body.error).toContain('maximum');
    });
  });

  describe('Optimistic Locking Tests', () => {
    it('should handle optimistic locking with version mismatch', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        version: 5 // Current version
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          title: 'Updated Title',
          version: 3 // Old version
        }),
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

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('version');
      expect(body.error).toContain('conflict');
      expect(body.currentVersion).toBe(5);
      expect(dynamoMock).not.toHaveReceivedCommand(UpdateItemCommand);
    });

    it('should succeed when version matches', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        version: 3
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          title: 'Updated Title',
          version: 4,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          title: 'Updated Title',
          version: 3 // Matches current
        }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.version).toBe(4);
    });

    it('should increment version on successful update', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        version: 10
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          title: 'New Title',
          version: 11,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'New Title', version: 10 }),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.version).toBe(11);
    });

    it('should require version in update request', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'New Title' }), // Missing version
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
      expect(body.error).toContain('version');
      expect(body.error).toContain('required');
    });
  });

  describe('Error Handling Tests', () => {
    it('should return 404 when content does not exist', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined
      });

      const event = {
        pathParameters: { id: 'non-existent-id' },
        body: JSON.stringify({ title: 'Update', version: 1 }),
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
    });

    it('should return 400 for invalid JSON body', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: 'invalid json{',
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
      expect(body.error).toContain('Invalid');
    });

    it('should return 400 when missing content ID', async () => {
      const event = {
        pathParameters: {},
        body: JSON.stringify({ title: 'Update', version: 1 }),
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
        body: JSON.stringify({ title: 'Update', version: 1 }),
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

    it('should return 401 when user is not authenticated', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Update', version: 1 }),
        requestContext: {
          authorizer: undefined
        }
      };

      const result = await handler(event as any);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Unauthorized');
    });
  });

  describe('Validation Tests', () => {
    it('should validate title length', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          title: 'a'.repeat(501), // Too long
          version: 1
        }),
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
      expect(body.error).toContain('title');
      expect(body.error).toContain('length');
    });

    it('should validate description length', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({
          description: 'a'.repeat(5001), // Too long
          version: 1
        }),
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
      expect(body.error).toContain('description');
    });

    it('should allow valid update with all fields', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        version: 1
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const validUpdate = {
        title: 'Valid Title',
        description: 'Valid description with proper length',
        visibility: 'public',
        tags: ['tag1', 'tag2'],
        version: 1
      };

      dynamoMock.on(UpdateItemCommand).resolves({
        Attributes: marshall({
          ...mockExistingContent,
          ...validUpdate,
          version: 2,
          updatedAt: new Date().toISOString()
        })
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify(validUpdate),
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

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.title).toBe('Valid Title');
      expect(body.visibility).toBe('public');
      expect(body.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('Concurrent Update Scenarios', () => {
    it('should handle race condition with proper error message', async () => {
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        title: 'Title',
        version: 2
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Update', version: 1 }),
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

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.error).toBeDefined();
      expect(body.currentVersion).toBe(2);
      expect(body.message).toContain('retry');
    });

    it('should provide current version in conflict response', async () => {
      const currentVersion = 7;
      const mockExistingContent = {
        id: mockContentId,
        userId: mockUserId,
        version: currentVersion
      };

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(mockExistingContent)
      });

      const event = {
        pathParameters: { id: mockContentId },
        body: JSON.stringify({ title: 'Update', version: 5 }),
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

      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.currentVersion).toBe(currentVersion);
    });
  });
});