import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../../../src/backend/lambdas/content/update';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../../repositories/test-setup';
import { Visibility } from '@aws-community-hub/shared';

jest.mock('../../../../src/backend/services/EmbeddingService', () => {
  return {
    EmbeddingService: jest.fn().mockImplementation(() => ({
      generateContentEmbedding: jest.fn().mockResolvedValue([0.01, 0.02]),
    })),
  };
});

const createEvent = (
  userId: string,
  contentId: string,
  body: Record<string, unknown>
): APIGatewayProxyEvent =>
  ({
    httpMethod: 'PUT',
    path: `/content/${contentId}`,
    pathParameters: { id: contentId },
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'req-integration',
      authorizer: {
        userId,
        claims: {
          sub: userId,
        },
      },
    },
  } as unknown as APIGatewayProxyEvent);

const createContext = (): Context =>
  ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'content-update',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:content-update',
    memoryLimitInMB: '256',
    awsRequestId: 'integration-test',
    logGroupName: '/aws/lambda/content-update',
    logStreamName: 'test',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  } as Context);

describe('Content Update Lambda (integration)', () => {
  let pool: any;
  let ownerId: string;
  let adminId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    const owner = await createTestUser(pool, {
      username: 'owner-user',
      isAdmin: false,
    });
    ownerId = owner.id;

    const admin = await createTestUser(pool, {
      username: 'admin-user',
      isAdmin: true,
    });
    adminId = admin.id;
  });

  it('updates content for owner and increments version', async () => {
    const content = await createTestContent(pool, ownerId, {
      title: 'Original Title',
      tags: ['aws'],
      visibility: Visibility.PUBLIC,
    });
    const initialRow = await pool.query('SELECT updated_at FROM content WHERE id = $1', [
      content.id,
    ]);
    const originalUpdatedAt = new Date(initialRow.rows[0].updated_at);

    const event = createEvent(ownerId, content.id, {
      title: 'Revised Title',
      tags: ['aws', 'lambda'],
      version: content.version ?? 1,
    });

    const response = await handler(event, createContext());
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.title).toBe('Revised Title');
    expect(body.tags).toEqual(['aws', 'lambda']);
    expect(body.version).toBe((content.version ?? 1) + 1);

    const dbResult = await pool.query('SELECT title, version, updated_at FROM content WHERE id = $1', [
      content.id,
    ]);
    const dbRow = dbResult.rows[0];
    expect(dbRow.title).toBe('Revised Title');
    expect(dbRow.version).toBe((content.version ?? 1) + 1);
    const updatedTimestamp = new Date(dbRow.updated_at ?? dbRow.updatedAt);
    expect(updatedTimestamp.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it('returns 409 when version is stale', async () => {
    const content = await createTestContent(pool, ownerId, {
      title: 'Needs Update',
      tags: ['aws'],
      visibility: Visibility.PUBLIC,
    });

    // First update advances the version.
    await handler(
      createEvent(ownerId, content.id, { title: 'Intermediate Title', version: content.version ?? 1 }),
      createContext()
    );

    const staleVersionEvent = createEvent(ownerId, content.id, {
      title: 'Stale Update',
      version: content.version ?? 1,
    });

    const response = await handler(staleVersionEvent, createContext());
    expect(response.statusCode).toBe(409);
  });

  it('allows admin to update other user content', async () => {
    const content = await createTestContent(pool, ownerId, {
      title: 'Shared Content',
      visibility: Visibility.PUBLIC,
    });

    // Refresh content to include version from database
    const dbFetch = await pool.query('SELECT id, version FROM content WHERE id = $1', [content.id]);
    const currentVersion = dbFetch.rows[0].version;

    const event = createEvent(adminId, content.id, {
      visibility: Visibility.PRIVATE,
      version: currentVersion,
    });

    const response = await handler(event, createContext());
    expect(response.statusCode).toBe(200);

    const updatedRow = await pool.query('SELECT visibility, version FROM content WHERE id = $1', [
      content.id,
    ]);
    expect(updatedRow.rows[0].visibility).toBe(Visibility.PRIVATE);
    expect(updatedRow.rows[0].version).toBe(currentVersion + 1);
  });
});
