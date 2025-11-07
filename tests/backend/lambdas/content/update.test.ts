import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/update';
import { Visibility } from '@aws-community-hub/shared';

const mockPool = {} as any;

const mockContentRepository = {
  findById: jest.fn(),
  updateWithEmbedding: jest.fn(),
};

const mockUserRepository = {
  findById: jest.fn(),
};

const mockEmbeddingService = {
  generateContentEmbedding: jest.fn(),
};

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

jest.mock('../../../../src/backend/repositories/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => mockContentRepository),
}));

jest.mock('../../../../src/backend/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => mockUserRepository),
}));

jest.mock('../../../../src/backend/services/EmbeddingService', () => ({
  EmbeddingService: jest.fn().mockImplementation(() => mockEmbeddingService),
}));

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { ContentRepository } = require('../../../../src/backend/repositories/ContentRepository');
const { UserRepository } = require('../../../../src/backend/repositories/UserRepository');
const { EmbeddingService } = require('../../../../src/backend/services/EmbeddingService');

const baseEvent: Partial<APIGatewayProxyEvent> = {
  httpMethod: 'PUT',
  path: '/content/123',
  pathParameters: { id: '123' },
  headers: {
    'Content-Type': 'application/json',
  },
  requestContext: {
    requestId: 'req-id',
    authorizer: {
      userId: 'user-1',
      claims: {
        sub: 'user-1',
      },
    },
  } as any,
};

describe('Content Update Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    (ContentRepository as unknown as jest.Mock).mockImplementation(() => mockContentRepository);
    (UserRepository as unknown as jest.Mock).mockImplementation(() => mockUserRepository);
    (EmbeddingService as unknown as jest.Mock).mockImplementation(() => mockEmbeddingService);

    mockContentRepository.findById.mockReset();
    mockContentRepository.updateWithEmbedding.mockReset();

    mockUserRepository.findById.mockReset();
    mockEmbeddingService.generateContentEmbedding.mockReset();
  });

  const createEventWithBody = (body: Record<string, unknown>): APIGatewayProxyEvent => ({
    ...(baseEvent as APIGatewayProxyEvent),
    body: JSON.stringify(body),
  });

  const existingContent = {
    id: '123',
    userId: 'user-1',
    title: 'Original Title',
    description: 'Original Description',
    contentType: 'blog',
    visibility: Visibility.PUBLIC,
    publishDate: new Date('2024-01-01T00:00:00Z'),
    captureDate: new Date('2024-01-02T00:00:00Z'),
    metrics: {},
    tags: ['aws'],
    embedding: null,
    isClaimed: true,
    originalAuthor: 'Jane Doe',
    urls: [{ id: 'url-1', url: 'https://example.com' }],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    version: 1,
  };

  const updatedContent = {
    ...existingContent,
    title: 'Updated Title',
    tags: ['aws', 'serverless'],
    updatedAt: new Date('2024-01-03T00:00:00Z'),
    version: 2,
  };

  it('updates content for owner with optimistic locking', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'user-1', isAdmin: false });
    mockContentRepository.findById.mockResolvedValue(existingContent);
    mockContentRepository.updateWithEmbedding.mockResolvedValue(updatedContent);
    mockEmbeddingService.generateContentEmbedding.mockResolvedValue([0.1, 0.2]);

    const event = createEventWithBody({
      title: '  Updated Title  ',
      tags: ['aws', 'serverless', 'aws'],
      version: 1,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.title).toBe('Updated Title');
    expect(body.tags).toEqual(['aws', 'serverless']);
    expect(body.version).toBe(2);

    expect(mockContentRepository.updateWithEmbedding).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        title: 'Updated Title',
        tags: ['aws', 'serverless'],
        embedding: [0.1, 0.2],
      }),
      { expectedVersion: 1 }
    );
  });

  it('rejects updates from non-owner non-admin', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'user-2', isAdmin: false });
    mockContentRepository.findById.mockResolvedValue(existingContent);

    const event = {
      ...(baseEvent as APIGatewayProxyEvent),
      body: JSON.stringify({ title: 'New Title', version: 1 }),
      requestContext: {
        ...(baseEvent.requestContext as any),
        authorizer: {
          userId: 'user-2',
          claims: { sub: 'user-2' },
        },
      },
    } as APIGatewayProxyEvent;

    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    expect(mockContentRepository.updateWithEmbedding).not.toHaveBeenCalled();
  });

  it('allows admin to update another user content', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'admin-user', isAdmin: true });
    mockContentRepository.findById.mockResolvedValue(existingContent);
    mockContentRepository.updateWithEmbedding.mockResolvedValue(updatedContent);

    const event = {
      ...(baseEvent as APIGatewayProxyEvent),
      body: JSON.stringify({ visibility: Visibility.PRIVATE, version: 1 }),
      requestContext: {
        ...(baseEvent.requestContext as any),
        authorizer: {
          userId: 'admin-user',
          claims: { sub: 'admin-user' },
        },
      },
    } as APIGatewayProxyEvent;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(mockContentRepository.updateWithEmbedding).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({
        visibility: Visibility.PRIVATE,
      }),
      { expectedVersion: 1 }
    );
  });

  it('returns 409 on version mismatch', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'user-1', isAdmin: false });
    mockContentRepository.findById.mockResolvedValue(existingContent);
    mockContentRepository.updateWithEmbedding.mockResolvedValue(null);

    const event = createEventWithBody({ title: 'New', version: 0 });

    const response = await handler(event);

    expect(response.statusCode).toBe(409);
  });

  it('returns validation error for invalid tags', async () => {
    const event = createEventWithBody({ tags: 'not-array', version: 1 });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns validation error when no change provided', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'user-1', isAdmin: false });
    mockContentRepository.findById.mockResolvedValue(existingContent);

    const event = createEventWithBody({ version: 1 });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.message).toContain('No updateable fields');
  });

  it('continues when embedding generation fails', async () => {
    mockUserRepository.findById.mockResolvedValue({ id: 'user-1', isAdmin: false });
    mockContentRepository.findById.mockResolvedValue(existingContent);
    mockContentRepository.updateWithEmbedding.mockResolvedValue(updatedContent);
    mockEmbeddingService.generateContentEmbedding.mockRejectedValue(
      new Error('Bedrock failure')
    );

    const event = createEventWithBody({ title: 'Updated Title', version: 1 });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(mockContentRepository.updateWithEmbedding).toHaveBeenCalledWith(
      '123',
      expect.not.objectContaining({ embedding: expect.anything() }),
      { expectedVersion: 1 }
    );
  });
});
