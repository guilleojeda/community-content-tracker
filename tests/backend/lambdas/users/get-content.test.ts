import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/get-content';
import { ContentType, Visibility } from '@aws-community-hub/shared';

const mockFindById = jest.fn();
const mockFindByUserId = jest.fn();

jest.mock('../../../../src/backend/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
  })),
}));

jest.mock('../../../../src/backend/repositories/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({
    findByUserId: mockFindByUserId,
  })),
}));

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { UserRepository } = require('../../../../src/backend/repositories/UserRepository');
const { ContentRepository } = require('../../../../src/backend/repositories/ContentRepository');

describe('Get User Content Lambda', () => {
  const mockUser = {
    id: 'user-123',
    username: 'contentuser',
  };

  const mockContent = {
    id: 'content-1',
    userId: 'user-123',
    title: 'Sample Content',
    description: 'Description',
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2024-01-01T00:00:00.000Z'),
    captureDate: new Date('2024-01-02T00:00:00.000Z'),
    metrics: { views: 10 },
    tags: ['aws'],
    isClaimed: true,
    originalAuthor: null,
    urls: [{ id: 'url-1', url: 'https://example.com' }],
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-03T00:00:00.000Z'),
    deletedAt: null,
    version: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue({});
    (UserRepository as jest.Mock).mockImplementation(() => ({
      findById: mockFindById,
    }));
    (ContentRepository as jest.Mock).mockImplementation(() => ({
      findByUserId: mockFindByUserId,
    }));
  });

  it('should require authentication when requesting /users/me', async () => {
    const result = await handler({
      pathParameters: { id: 'me' },
    } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should return 400 for invalid content type', async () => {
    const result = await handler({
      pathParameters: { id: 'user-123' },
      queryStringParameters: { contentType: 'invalid-type' },
    } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return content list with total when limit is provided', async () => {
    mockFindById.mockResolvedValueOnce(mockUser);
    mockFindByUserId
      .mockResolvedValueOnce([mockContent])
      .mockResolvedValueOnce([mockContent, { ...mockContent, id: 'content-2' }]);

    const result = await handler({
      pathParameters: { id: 'user-123' },
      queryStringParameters: { limit: '1' },
    } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.total).toBe(2);
    expect(body.content).toHaveLength(1);
    expect(body.content[0].id).toBe('content-1');
  });
});
