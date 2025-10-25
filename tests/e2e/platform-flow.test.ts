import { setupTestDatabase, teardownTestDatabase, resetTestData, testDb } from '../backend/repositories/test-setup';
import { UserRepository } from '../../src/backend/repositories/UserRepository';
import { ChannelRepository } from '../../src/backend/repositories/ChannelRepository';
import { ContentRepository } from '../../src/backend/repositories/ContentRepository';
import { BadgeRepository } from '../../src/backend/repositories/BadgeRepository';
import { Visibility, ContentType, BadgeType } from '@aws-community-hub/shared';
import { handler as registerHandler } from '../../src/backend/lambdas/auth/register';
import { handler as verifyEmailHandler } from '../../src/backend/lambdas/auth/verify-email';
import { handler as exportDataHandler } from '../../src/backend/lambdas/users/export-data';
import { handler as deleteAccountHandler } from '../../src/backend/lambdas/users/delete-account';
import { handler as channelCreateHandler } from '../../src/backend/lambdas/channels/create';
import { handler as contentCreateHandler } from '../../src/backend/lambdas/content/create';
import { handler as claimHandler } from '../../src/backend/lambdas/content/claim';
import { handler as programExportHandler } from '../../src/backend/lambdas/export/csv-export';
import { handler as analyticsExportHandler } from '../../src/backend/lambdas/analytics/export-analytics';
import { handler as analyticsUserHandler } from '../../src/backend/lambdas/analytics/user-analytics';
import { handler as adminBadgesHandler } from '../../src/backend/lambdas/admin/badges';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

jest.mock('../../src/backend/services/database', () => {
  const actual = jest.requireActual('../../src/backend/services/database');
  return {
    ...actual,
    getDatabasePool: jest.fn(),
  };
});

jest.mock('../../src/backend/lambdas/auth/tokenVerifier', () => ({
  verifyJwtToken: jest.fn(),
}));

const { getDatabasePool } = require('../../src/backend/services/database');
const { verifyJwtToken } = require('../../src/backend/lambdas/auth/tokenVerifier');
const cognitoMock = mockClient(CognitoIdentityProviderClient);

const originalFetch = global.fetch;

describe('Platform end-to-end flows', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    (getDatabasePool as jest.Mock).mockImplementation(async () => testDb.pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  const tokenMap: Record<string, any> = {};

  const baseEvent: APIGatewayProxyEvent = {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    stageVariables: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '/',
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      authorizer: {},
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'jest',
        userArn: null,
      },
      path: '/',
      stage: 'test',
      requestId: 'req-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource',
      resourcePath: '/',
    },
  };

  const createEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => {
    const requestContextOverride = overrides.requestContext || {};
    const identityOverride = requestContextOverride.identity || {};
    const authorizerOverride = requestContextOverride.authorizer || {};

    return {
      ...baseEvent,
      ...overrides,
      headers: { ...baseEvent.headers, ...(overrides.headers || {}) },
      multiValueHeaders: {
        ...baseEvent.multiValueHeaders,
        ...(overrides.multiValueHeaders || {}),
      },
      requestContext: {
        ...baseEvent.requestContext,
        ...requestContextOverride,
        requestTimeEpoch: Date.now(),
        identity: {
          ...baseEvent.requestContext.identity,
          ...identityOverride,
        },
        authorizer: {
          ...(baseEvent.requestContext.authorizer || {}),
          ...authorizerOverride,
        },
      },
    } as APIGatewayProxyEvent;
  };

  beforeEach(() => {
    (getDatabasePool as jest.Mock).mockImplementation(async () => testDb.pool);
    Object.keys(tokenMap).forEach((key) => delete tokenMap[key]);
    (global as any).fetch = jest.fn().mockResolvedValue({ status: 200 });
    cognitoMock.reset();
    cognitoMock.callsFake(async (command: any) => {
      const candidateInput =
        command && typeof command === 'object' && 'input' in command ? command.input : command;

      const username = candidateInput?.Username ?? candidateInput?.username;
      const password = candidateInput?.Password ?? candidateInput?.password;

      if (username && password) {
        return { UserSub: `cognito-sub-${Date.now()}` };
      }

      if (candidateInput && 'AccessToken' in candidateInput) {
        return {};
      }

      if (
        candidateInput &&
        'UserPoolId' in candidateInput &&
        'Username' in candidateInput &&
        !('Password' in candidateInput)
      ) {
        return {};
      }

      const confirmation = candidateInput?.ConfirmationCode ?? candidateInput?.confirmationCode;
      if (confirmation || (command && typeof command === 'object' && 'ConfirmationCode' in command)) {
        return {};
      }

      return {};
    });
    (verifyJwtToken as jest.Mock).mockImplementation(async (token: string) => {
      const mappedUser = tokenMap[token];
      if (mappedUser) {
        return { isValid: true, user: mappedUser };
      }
      return {
        isValid: false,
        error: { code: 'AUTH_INVALID', message: 'Token not recognised', details: 'Mock token map miss' },
      };
    });
  });

  afterEach(async () => {
    (global as any).fetch = originalFetch;
    jest.resetAllMocks();
    cognitoMock.reset();
    await resetTestData();
  });

  it('covers core creator, admin, and GDPR journeys', async () => {
    const pool = testDb.pool;
    const userRepo = new UserRepository(pool);
    const channelRepo = new ChannelRepository(pool);
    const contentRepo = new ContentRepository(pool);
    const badgeRepo = new BadgeRepository(pool);

    // 1. Registration flow via Lambda handler
    const registrationEvent = createEvent({
      httpMethod: 'POST',
      path: '/auth/register',
      body: JSON.stringify({
        email: 'creator@example.com',
        password: 'TestPassword123!',
        username: 'power_creator',
      }),
    });

    const registrationResult = await registerHandler(registrationEvent, {} as any);
    expect(registrationResult.statusCode).toBe(201);

    const primaryUser = await userRepo.findByEmail('creator@example.com');
    if (!primaryUser) {
      throw new Error('Primary user was not created via registration');
    }
    tokenMap['primary-token'] = { ...primaryUser, isAdmin: false };

    const verificationEvent = createEvent({
      httpMethod: 'GET',
      path: '/auth/verify-email',
      resource: '/auth/verify-email',
      queryStringParameters: {
        email: 'creator@example.com',
        code: '123456',
      },
      requestContext: {
        httpMethod: 'GET',
        path: '/auth/verify-email',
        resourcePath: '/auth/verify-email',
      } as any,
    });
    const verificationResult = await verifyEmailHandler(verificationEvent, {} as any);
    expect(verificationResult.statusCode).toBe(200);
    expect(JSON.parse(verificationResult.body).verified).toBe(true);

    const adminUser = await userRepo.createUser({
      email: 'admin@example.com',
      username: 'admin_user',
      profileSlug: 'admin-user',
      defaultVisibility: Visibility.PUBLIC,
      cognitoSub: 'cognito-admin-1',
      isAdmin: true,
      isAwsEmployee: false,
    });
    tokenMap['admin-token'] = { ...adminUser, isAdmin: true };

    // 2. Channel setup via Lambda handler
    const channelResponse = await channelCreateHandler(
      createEvent({
        httpMethod: 'POST',
        path: '/channels',
        body: JSON.stringify({
          url: 'https://youtube.com/@creator',
          name: 'Creator Channel',
        }),
        requestContext: {
          authorizer: { userId: primaryUser.id },
        } as any,
      }),
      {} as any
    );
    expect(channelResponse.statusCode).toBe(201);
    const createdChannel = JSON.parse(channelResponse.body);
    expect(createdChannel.userId).toBe(primaryUser.id);

    await channelRepo.updateSyncStatus(createdChannel.id, 'success');

    // 3. Content creation via Lambda handler
    const baseContentPayloads = [
      {
        title: 'Serverless Deep Dive',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        urls: ['https://blog.example.com/serverless-deep-dive'],
        tags: ['serverless', 'lambda'],
      },
      {
        title: 'Building with CDK',
        contentType: ContentType.YOUTUBE,
        visibility: Visibility.PUBLIC,
        urls: ['https://youtu.be/cdk-demo'],
        tags: ['cdk', 'infrastructure'],
      },
      {
        title: 'Aurora Performance Tuning',
        contentType: ContentType.WHITEPAPER,
        visibility: Visibility.AWS_ONLY,
        urls: ['https://docs.example.com/aurora.pdf'],
        tags: ['aurora'],
      },
    ];

    const handledTypes = new Set(baseContentPayloads.map((payload) => payload.contentType));
    const additionalPayloads = (Object.values(ContentType) as ContentType[])
      .filter((type) => !handledTypes.has(type))
      .map((type, index) => ({
        title: `Additional ${type} ${index}`,
        contentType: type,
        visibility: Visibility.PUBLIC,
        urls: [`https://content.example.com/${type}/${index}`],
        tags: [type.replace(/_/g, '-')],
      }));

    const contentPayloads = [...baseContentPayloads, ...additionalPayloads];

    const createdContentIds: string[] = [];

    for (const payload of contentPayloads) {
      const createResponse = await contentCreateHandler(
        createEvent({
          httpMethod: 'POST',
          path: '/content',
          body: JSON.stringify(payload),
          requestContext: {
            authorizer: { userId: primaryUser.id },
          } as any,
        }),
        {} as any
      );
      expect(createResponse.statusCode).toBe(201);
      const body = JSON.parse(createResponse.body);
      createdContentIds.push(body.id);
    }

    const createdContent = await Promise.all(createdContentIds.map((id) => contentRepo.findById(id)));
    expect(createdContent.filter(Boolean)).toHaveLength(contentPayloads.length);

    const orphanContentResponse = await contentCreateHandler(
      createEvent({
        httpMethod: 'POST',
        path: '/content',
        body: JSON.stringify({
          title: 'Unclaimed Content',
          contentType: ContentType.PODCAST,
          visibility: Visibility.PUBLIC,
          isClaimed: false,
          originalAuthor: primaryUser.username,
          urls: ['https://podcasts.example.com/episode1'],
          tags: ['podcast'],
        }),
        requestContext: {
          authorizer: { userId: primaryUser.id },
        } as any,
      }),
      {} as any
    );
    expect(orphanContentResponse.statusCode).toBe(201);
    const orphanBody = JSON.parse(orphanContentResponse.body);

    // 4. Search flows (anonymous and authenticated)
    const anonymousResults = await contentRepo.keywordSearch('Serverless', {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 10,
      offset: 0,
    });
    expect(anonymousResults.length).toBeGreaterThan(0);

    const authenticatedResults = await contentRepo.keywordSearch('Aurora', {
      visibilityLevels: [Visibility.PUBLIC, Visibility.AWS_ONLY],
      ownerId: primaryUser.id,
      limit: 10,
      offset: 0,
    });
    expect(authenticatedResults.some((item) => item.visibility === Visibility.AWS_ONLY)).toBe(true);

    // 5. Content claiming flow via Lambda handler
    const claimResponse = await claimHandler(
      createEvent({
        httpMethod: 'POST',
        path: `/content/${orphanBody.id}/claim`,
        pathParameters: { id: orphanBody.id },
        headers: { Authorization: 'Bearer primary-token' },
        requestContext: {
          authorizer: { userId: primaryUser.id, isAdmin: false },
          identity: { sourceIp: '127.0.0.1' } as any,
        } as any,
      }),
      {} as any
    );
    expect(claimResponse.statusCode).toBe(200);

    const claimedRecord = await contentRepo.findById(orphanBody.id);
    expect(claimedRecord?.isClaimed).toBe(true);

    // 6. Admin badge granting via Lambda handler
    const badgeGrantResponse = await adminBadgesHandler(
      createEvent({
        httpMethod: 'POST',
        path: '/admin/badges',
        body: JSON.stringify({
          userId: primaryUser.id,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          reason: 'Consistent community contributions',
        }),
        headers: { Authorization: 'Bearer admin-token' },
        requestContext: {
          authorizer: { userId: adminUser.id, isAdmin: true },
        } as any,
      }),
      {} as any
    );
    expect([200, 201]).toContain(badgeGrantResponse.statusCode);
    const hasBadge = await badgeRepo.userHasBadge(primaryUser.id, BadgeType.COMMUNITY_BUILDER);
    expect(hasBadge).toBe(true);

    // 7. Analytics API (user analytics & CSV export)
    const analyticsEvent = await analyticsUserHandler(
      createEvent({
        httpMethod: 'GET',
        path: '/analytics/user',
        headers: { Authorization: 'Bearer primary-token' },
        requestContext: {
          authorizer: { userId: primaryUser.id },
          identity: { sourceIp: '127.0.0.1' } as any,
        } as any,
      }),
      {} as any
    );
    expect(analyticsEvent.statusCode).toBe(200);

    const analyticsExport = await analyticsExportHandler(
      createEvent({
        httpMethod: 'GET',
        path: '/analytics/export',
        queryStringParameters: { groupBy: 'day' },
        headers: { Authorization: 'Bearer primary-token' },
        requestContext: {
          authorizer: { userId: primaryUser.id },
          identity: { sourceIp: '127.0.0.1' } as any,
        } as any,
      }),
      {} as any
    );
    expect(analyticsExport.statusCode).toBe(200);

    const programTypes: Array<'community_builder' | 'hero' | 'ambassador' | 'user_group_leader'> = [
      'community_builder',
      'hero',
      'ambassador',
      'user_group_leader',
    ];

    for (const programType of programTypes) {
      const programExport = await programExportHandler(
        createEvent({
          httpMethod: 'POST',
          path: '/export/csv',
          body: JSON.stringify({
            exportType: 'program',
            programType,
            includePrivate: false,
          }),
          headers: { Authorization: 'Bearer primary-token' },
          requestContext: {
            authorizer: { userId: primaryUser.id },
            identity: { sourceIp: '127.0.0.1' } as any,
          } as any,
        }),
        {} as any
      );

      expect(programExport.statusCode).toBe(200);
      expect(programExport.body).toContain('Title');
    }

    // 8. GDPR export flow
    const exportEvent = await exportDataHandler(
      createEvent({
        httpMethod: 'GET',
        path: '/users/me/export',
        pathParameters: { id: 'me' },
        headers: { Authorization: 'Bearer primary-token' },
        requestContext: {
          authorizer: { userId: primaryUser.id },
          identity: { sourceIp: '127.0.0.1' } as any,
        } as any,
      }),
      {} as any
    );
    expect(exportEvent.statusCode).toBe(200);
    const exportPayload = JSON.parse(exportEvent.body || '{}');
    expect(exportPayload.user.id).toBe(primaryUser.id);
    expect(Array.isArray(exportPayload.content)).toBe(true);

    // 9. GDPR deletion flow
    const deleteEvent = await deleteAccountHandler(
      createEvent({
        httpMethod: 'DELETE',
        path: '/users/me',
        pathParameters: { id: 'me' },
        headers: { Authorization: 'Bearer primary-token' },
        requestContext: {
          authorizer: { userId: primaryUser.id },
          identity: { sourceIp: '127.0.0.1' } as any,
        } as any,
      }),
      {} as any
    );
    expect(deleteEvent.statusCode).toBe(200);

    const deletedUser = await userRepo.findById(primaryUser.id);
    expect(deletedUser).toBeNull();
  });
});
