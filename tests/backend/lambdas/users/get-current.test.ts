import { APIGatewayProxyEvent } from 'aws-lambda';
import { Visibility } from '@aws-community-hub/shared';

const mockFindById = jest.fn();

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));
jest.mock('../../../../src/backend/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
  })),
}));

const mockPool = {
  query: jest.fn(),
};

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { UserRepository } = require('../../../../src/backend/repositories/UserRepository');
const { handler } = require('../../../../src/backend/lambdas/users/get-current');

describe('Get Current User Lambda', () => {
  const mockUser = {
    id: 'user-123',
    cognitoSub: 'cognito-123',
    email: 'user@example.com',
    username: 'currentuser',
    profileSlug: 'currentuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    receiveNewsletter: true,
    receiveContentNotifications: true,
    receiveCommunityUpdates: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue(mockPool);
    (UserRepository as jest.Mock).mockImplementation(() => ({
      findById: mockFindById,
    }));
  });

  const createEvent = (authorizer?: Record<string, any>): Partial<APIGatewayProxyEvent> => ({
    requestContext: {
      authorizer,
    } as any,
  });

  it('should return 401 when authentication context is missing', async () => {
    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('should return 401 when user lookup fails', async () => {
    mockFindById.mockResolvedValue(null);

    const result = await handler(createEvent({ userId: 'missing-user' }) as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('AUTH_INVALID');
  });

  it('should return current user when authorizer context is valid', async () => {
    mockFindById.mockResolvedValue(mockUser);

    const result = await handler(createEvent({ userId: mockUser.id }) as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({
      id: mockUser.id,
      email: mockUser.email,
      username: mockUser.username,
    });
  });
});
