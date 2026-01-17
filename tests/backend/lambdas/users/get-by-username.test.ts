import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/users/get-by-username';
import { Visibility } from '@aws-community-hub/shared';

const mockFindByUsername = jest.fn();

jest.mock('../../../../src/backend/repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    findByUsername: mockFindByUsername,
  })),
}));

jest.mock('../../../../src/backend/services/database', () => ({
  getDatabasePool: jest.fn(),
}));

const { getDatabasePool } = require('../../../../src/backend/services/database');
const { UserRepository } = require('../../../../src/backend/repositories/UserRepository');

describe('Get User By Username Lambda', () => {
  const mockUser = {
    id: 'user-123',
    cognitoSub: 'cognito-123',
    email: 'user@example.com',
    username: 'lookupuser',
    profileSlug: 'lookupuser',
    defaultVisibility: Visibility.PUBLIC,
    isAdmin: false,
    isAwsEmployee: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabasePool as jest.Mock).mockResolvedValue({});
    (UserRepository as jest.Mock).mockImplementation(() => ({
      findByUsername: mockFindByUsername,
    }));
  });

  it('should return 400 when username is missing', async () => {
    const result = await handler({ pathParameters: {} } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 when user is not found', async () => {
    mockFindByUsername.mockResolvedValueOnce(null);

    const result = await handler({
      pathParameters: { username: 'missing' },
    } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return user data when found', async () => {
    mockFindByUsername.mockResolvedValueOnce(mockUser);

    const result = await handler({
      pathParameters: { username: 'lookupuser' },
    } as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.user).toMatchObject({
      id: mockUser.id,
      username: mockUser.username,
      email: '',
    });
  });

  it('returns email when the requester is the profile owner', async () => {
    mockFindByUsername.mockResolvedValueOnce(mockUser);

    const result = await handler({
      pathParameters: { username: 'lookupuser' },
      requestContext: { authorizer: { userId: mockUser.id } },
    } as APIGatewayProxyEvent);

    const body = JSON.parse(result.body);
    expect(body.user.email).toBe(mockUser.email);
  });

  it('returns email when the requester is an admin', async () => {
    mockFindByUsername.mockResolvedValueOnce(mockUser);

    const result = await handler({
      pathParameters: { username: 'lookupuser' },
      requestContext: { authorizer: { userId: 'admin-id', isAdmin: 'true' } },
    } as APIGatewayProxyEvent);

    const body = JSON.parse(result.body);
    expect(body.user.email).toBe(mockUser.email);
  });
});
