import { handler } from '../../../../src/backend/lambdas/content/delete';
import { getDatabasePool, setTestDatabasePool, closeDatabasePool } from '../../../../src/backend/services/database';
import { ContentRepository } from '../../../../src/backend/repositories/ContentRepository';
import { UserRepository } from '../../../../src/backend/repositories/UserRepository';
import { Content, User, Visibility, ContentType } from '../../../../src/shared/types';
import { Pool } from 'pg';

// Mock the database module
jest.mock('../../../../src/backend/services/database');
jest.mock('../../../../src/backend/repositories/ContentRepository');
jest.mock('../../../../src/backend/repositories/UserRepository');

describe('Delete Content Lambda', () => {
  const mockUserId = 'user-123';
  const mockAdminId = 'admin-456';
  const mockContentId = 'content-789';
  const mockOtherUserId = 'user-999';

  let mockPool: jest.Mocked<Pool>;
  let mockContentRepository: jest.Mocked<ContentRepository>;
  let mockUserRepository: jest.Mocked<UserRepository>;

  const createMockUser = (isAdmin: boolean = false): User => ({
    id: isAdmin ? mockAdminId : mockUserId,
    cognitoSub: isAdmin ? `cognito-${mockAdminId}` : `cognito-${mockUserId}`,
    email: isAdmin ? 'admin@test.com' : 'user@test.com',
    username: isAdmin ? 'admin' : 'testuser',
    profileSlug: isAdmin ? 'admin' : 'testuser',
    defaultVisibility: Visibility.PRIVATE,
    isAdmin,
    isAwsEmployee: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  });

  const createMockContent = (userId: string, deletedAt?: Date): Content => ({
    id: mockContentId,
    userId,
    title: 'Test Content',
    description: 'Test Description',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2025-01-01'),
    captureDate: new Date('2025-01-01'),
    metrics: {},
    tags: [],
    isClaimed: true,
    urls: [{ id: 'url-1', url: 'https://example.com' }],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {} as jest.Mocked<Pool>;
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);

    mockContentRepository = new ContentRepository(mockPool) as jest.Mocked<ContentRepository>;
    mockUserRepository = new UserRepository(mockPool) as jest.Mocked<UserRepository>;

    (ContentRepository as jest.MockedClass<typeof ContentRepository>).mockImplementation(() => mockContentRepository);
    (UserRepository as jest.MockedClass<typeof UserRepository>).mockImplementation(() => mockUserRepository);

    // Default: soft delete enabled
    process.env.ENABLE_SOFT_DELETE = 'true';
  });

  afterEach(() => {
    delete process.env.ENABLE_SOFT_DELETE;
  });

  describe('Owner Delete Tests', () => {
    it('should allow owner to delete content', async () => {
      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      expect(mockContentRepository.deleteContent).toHaveBeenCalledWith(mockContentId, true);
    });

    it('should return 204 No Content on success', async () => {
      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      expect(result.headers?.['Content-Length']).toBe('0');
    });
  });

  describe('Admin Permission Tests', () => {
    it('should allow admin to delete any content', async () => {
      const mockAdmin = createMockUser(true);
      const mockContent = createMockContent(mockOtherUserId);

      mockUserRepository.findById.mockResolvedValue(mockAdmin);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      expect(mockContentRepository.deleteContent).toHaveBeenCalled();
    });

    it('should allow admin with multiple groups to delete content', async () => {
      const mockAdmin = createMockUser(true);
      const mockContent = createMockContent(mockOtherUserId);

      mockUserRepository.findById.mockResolvedValue(mockAdmin);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
    });
  });

  describe('Authorization Tests', () => {
    it('should return 403 for non-owner attempts', async () => {
      const mockOtherUser = { ...createMockUser(false), id: mockOtherUserId };
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockOtherUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);

      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockOtherUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('not authorized');
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
    });

    it('should return 403 when user has no admin group', async () => {
      const mockOtherUser = { ...createMockUser(false), id: mockOtherUserId };
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockOtherUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(403);
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async () => {
      const event = {
        pathParameters: { id: mockContentId },
        requestContext: {
          authorizer: undefined
        }
      };

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('Authentication required');
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
    });
  });

  describe('Soft Delete Tests', () => {
    it('should soft delete when enabled', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      // Verify soft delete was called (second parameter true)
      expect(mockContentRepository.deleteContent).toHaveBeenCalledWith(mockContentId, true);
    });

    it('should hard delete when soft delete is disabled', async () => {
      process.env.ENABLE_SOFT_DELETE = 'false';

      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      // Verify hard delete was called (second parameter false)
      expect(mockContentRepository.deleteContent).toHaveBeenCalledWith(mockContentId, false);
    });

    it('should prevent deleting already soft-deleted content', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId, new Date('2025-01-01'));

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(410);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('already deleted');
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling Tests', () => {
    it('should return 404 when content does not exist', async () => {
      const mockUser = createMockUser(false);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(null);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('not found');
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('ID');
    });

    it('should return 500 on database error', async () => {
      const mockUser = createMockUser(false);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockRejectedValue(new Error('Database error'));

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('Failed');
    });

    it('should return 500 when delete operation fails', async () => {
      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId);

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(false);

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

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('Failed to delete content');
    });
  });

  describe('Query Parameter Tests', () => {
    it('should support force delete query parameter', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockAdmin = createMockUser(true);
      const mockContent = createMockContent(mockUserId, new Date('2025-01-01'));

      mockUserRepository.findById.mockResolvedValue(mockAdmin);
      mockContentRepository.findById.mockResolvedValue(mockContent);
      mockContentRepository.deleteContent.mockResolvedValue(true);

      const event = {
        pathParameters: { id: mockContentId },
        queryStringParameters: { force: 'true' },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockAdminId,
              'cognito:groups': JSON.stringify(['Admins'])
            }
          }
        }
      };

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(204);
      // Force delete should use hard delete (false)
      expect(mockContentRepository.deleteContent).toHaveBeenCalledWith(mockContentId, false);
    });

    it('should require admin role for force delete', async () => {
      process.env.ENABLE_SOFT_DELETE = 'true';

      const mockUser = createMockUser(false);
      const mockContent = createMockContent(mockUserId, new Date('2025-01-01'));

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockContentRepository.findById.mockResolvedValue(mockContent);

      const event = {
        pathParameters: { id: mockContentId },
        queryStringParameters: { force: 'true' },
        requestContext: {
          authorizer: {
            claims: {
              sub: mockUserId,
              'cognito:groups': '[]'
            }
          }
        }
      };

      const result = await handler(event as any, {} as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.message).toContain('admin');
      expect(mockContentRepository.deleteContent).not.toHaveBeenCalled();
    });
  });
});
