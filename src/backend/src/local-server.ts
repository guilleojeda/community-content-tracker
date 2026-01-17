import express from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { newDb, DataType } from 'pg-mem';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ContentType, Visibility, type User } from '@aws-community-hub/shared';
import { resetDatabaseCache, setTestDatabasePool, closeDatabasePool } from '../services/database';
import { UserRepository } from '../repositories/UserRepository';
import { ContentRepository } from '../repositories/ContentRepository';
import { buildCorsHeaders } from '../../shared/cors';

type LambdaHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

interface SeededProject {
  slug: string;
  creator: User;
  builder: User;
  admin: User;
}

interface SeedState {
  projects: Map<string, SeededProject>;
}

const TOKEN_PATTERN = /^(admin|test)-token-(.+)$/i;

const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const parseToken = (token: string | null): { slug: string; role: 'admin' | 'creator' } | null => {
  if (!token) {
    return null;
  }
  const match = token.match(TOKEN_PATTERN);
  if (!match) {
    return null;
  }
  const role = match[1].toLowerCase() === 'admin' ? 'admin' : 'creator';
  return { slug: normalizeSlug(match[2]), role };
};

const parseAuthToken = (request: Request): string | null => {
  const raw = request.header('authorization') || request.header('Authorization');
  if (!raw) {
    return null;
  }
  return raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
};

const normalizeHeaders = (headers: Request['headers']): Record<string, string> => {
  const normalized: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (Array.isArray(value)) {
      normalized[key] = value.join(',');
    }
  });
  return normalized;
};

const normalizeQuery = (query: Request['query']): Record<string, string> | null => {
  const normalized: Record<string, string> = {};
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.join(',');
    } else {
      normalized[key] = String(value);
    }
  });
  return Object.keys(normalized).length > 0 ? normalized : null;
};

const createContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'local-api',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:local-api',
  memoryLimitInMB: '256',
  awsRequestId: randomUUID(),
  logGroupName: '/aws/lambda/local-api',
  logStreamName: `local-${Date.now()}`,
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
});

const createEvent = (request: Request, authorizer?: Record<string, any>): APIGatewayProxyEvent => {
  const rawBody = request.body;
  const userAgentHeader = request.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader.join(',')
    : userAgentHeader ?? null;
  const body =
    rawBody === undefined || rawBody === null
      ? null
      : typeof rawBody === 'string'
      ? rawBody
      : JSON.stringify(rawBody);

  return {
    body,
    headers: normalizeHeaders(request.headers),
    multiValueHeaders: {},
    httpMethod: request.method,
    isBase64Encoded: false,
    path: request.path,
    pathParameters: Object.keys(request.params || {}).length > 0 ? request.params : null,
    queryStringParameters: normalizeQuery(request.query),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      protocol: 'HTTP/1.1',
      httpMethod: request.method,
      path: request.path,
      stage: 'local',
      requestId: randomUUID(),
      requestTimeEpoch: Date.now(),
      resourceId: 'local',
      resourcePath: request.path,
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
        sourceIp: request.ip || '127.0.0.1',
        user: null,
        userAgent,
        userArn: null,
      },
      authorizer: authorizer ?? null,
    },
    stageVariables: null,
    resource: request.path,
    multiValueQueryStringParameters: null,
  } as APIGatewayProxyEvent;
};

const buildAuthorizer = (user: User | null): Record<string, any> | undefined => {
  if (!user) {
    return undefined;
  }

  const groups = user.isAdmin ? ['Admin'] : [];

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    isAwsEmployee: user.isAwsEmployee,
    badges: JSON.stringify([]),
    groups,
    claims: {
      sub: user.id,
      email: user.email,
      username: user.username,
      'cognito:username': user.username,
      'cognito:groups': groups,
      'custom:is_admin': user.isAdmin ? 'true' : 'false',
      'custom:is_aws_employee': user.isAwsEmployee ? 'true' : 'false',
    },
  };
};

const sendLambdaResponse = (
  response: Response,
  result: APIGatewayProxyResult,
  origin?: string | string[]
): void => {
  const headers: Record<string, string> = {};
  if (result.headers) {
    Object.entries(result.headers).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        headers[key] = String(value);
      }
    });
  }
  if (origin) {
    const resolvedOrigin = Array.isArray(origin) ? origin[0] : origin;
    if (resolvedOrigin) {
      headers['Access-Control-Allow-Origin'] = resolvedOrigin;
      headers['Vary'] = 'Origin';
    }
  }

  response.status(result.statusCode || 200).set(headers);

  if (result.isBase64Encoded) {
    response.send(Buffer.from(result.body || '', 'base64'));
    return;
  }

  response.send(result.body ?? '');
};

const createCorsResponse = (origin?: string | null): Record<string, string> => {
  return buildCorsHeaders({
    origin,
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    allowCredentials: true,
  });
};

const createInMemoryPool = async (): Promise<Pool> => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  process.env.TEST_DB_INMEMORY = 'true';

  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'now',
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'clock_timestamp',
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'similarity',
    args: [DataType.text, DataType.text],
    returns: DataType.float,
    implementation: (a: string, b: string) => {
      if (!a || !b) {
        return 0;
      }
      const makeTrigrams = (input: string): Set<string> => {
        const normalized = `  ${input.toLowerCase()} `;
        const trigrams = new Set<string>();
        for (let i = 0; i < normalized.length - 2; i += 1) {
          trigrams.add(normalized.substring(i, i + 3));
        }
        return trigrams;
      };
      const trigramsA = makeTrigrams(a);
      const trigramsB = makeTrigrams(b);
      let intersection = 0;
      trigramsA.forEach((tri) => {
        if (trigramsB.has(tri)) {
          intersection += 1;
        }
      });
      const union = trigramsA.size + trigramsB.size - intersection;
      if (union === 0) {
        return 0;
      }
      return intersection / union;
    },
  });

  db.public.registerFunction({
    name: 'jsonb_build_object',
    args: [DataType.text, DataType.integer],
    returns: DataType.jsonb,
    implementation: (key: string, value: number) => ({ [key]: value }),
  });

  db.public.registerFunction({
    name: 'round',
    args: [DataType.float, DataType.float],
    returns: DataType.float,
    implementation: (value: number, precision: number) => {
      const factor = Math.pow(10, precision);
      return Math.round(value * factor) / factor;
    },
  });

  const pg = db.adapters.createPg();
  const pool = new pg.Pool() as unknown as Pool;

  const client = await pool.connect();
  try {
    const dropStatements = [
      'DROP TABLE IF EXISTS notifications CASCADE',
      'DROP TABLE IF EXISTS content_merge_history CASCADE',
      'DROP TABLE IF EXISTS user_consent CASCADE',
      'DROP TABLE IF EXISTS duplicate_pairs CASCADE',
      'DROP TABLE IF EXISTS saved_searches CASCADE',
      'DROP TABLE IF EXISTS admin_actions CASCADE',
      'DROP TABLE IF EXISTS analytics_events CASCADE',
      'DROP TABLE IF EXISTS channels CASCADE',
      'DROP TABLE IF EXISTS content_analytics CASCADE',
      'DROP TABLE IF EXISTS user_follows CASCADE',
      'DROP TABLE IF EXISTS content_bookmarks CASCADE',
      'DROP TABLE IF EXISTS user_badges CASCADE',
      'DROP TABLE IF EXISTS content_urls CASCADE',
      'DROP TABLE IF EXISTS content CASCADE',
      'DROP TABLE IF EXISTS users CASCADE',
    ];

    for (const statement of dropStatements) {
      await client.query(statement);
    }

    const simplifiedStatements = [
      `CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cognito_sub TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        profile_slug TEXT UNIQUE NOT NULL,
        default_visibility TEXT NOT NULL DEFAULT 'private',
        is_admin BOOLEAN NOT NULL DEFAULT false,
        is_aws_employee BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        content_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        publish_date TIMESTAMPTZ,
        capture_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        metrics JSONB DEFAULT '{}'::jsonb NOT NULL,
        tags TEXT[] DEFAULT '{}'::text[] NOT NULL,
        embedding JSONB,
        is_claimed BOOLEAN DEFAULT true NOT NULL,
        claimed_at TIMESTAMPTZ,
        original_author TEXT,
        is_flagged BOOLEAN DEFAULT false NOT NULL,
        flagged_at TIMESTAMPTZ,
        flagged_by TEXT,
        flag_reason TEXT,
        moderation_status TEXT DEFAULT 'approved' NOT NULL,
        moderated_at TIMESTAMPTZ,
        moderated_by UUID,
        deleted_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS content_urls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        deleted_at TIMESTAMPTZ,
        UNIQUE(content_id, url)
      )`,
      `CREATE TABLE IF NOT EXISTS user_badges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        badge_type TEXT NOT NULL,
        awarded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        awarded_by UUID,
        awarded_reason TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT true NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_by UUID,
        revoke_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, badge_type)
      )`,
      `CREATE TABLE IF NOT EXISTS content_bookmarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, content_id)
      )`,
      `CREATE TABLE user_follows (
        follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
        following_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        PRIMARY KEY (follower_id, following_id)
      )`,
      `CREATE TABLE content_analytics (
        content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
        views_count INTEGER DEFAULT 0,
        likes_count INTEGER DEFAULT 0,
        shares_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        engagement_score NUMERIC DEFAULT 0,
        last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        channel_type TEXT NOT NULL,
        url TEXT NOT NULL,
        name TEXT,
        enabled BOOLEAN DEFAULT true NOT NULL,
        last_sync_at TIMESTAMPTZ,
        last_sync_status TEXT,
        last_sync_error TEXT,
        sync_frequency TEXT DEFAULT 'daily' NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, url)
      )`,
      `CREATE TABLE analytics_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL,
        user_id UUID,
        session_id TEXT,
        content_id UUID,
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE admin_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_user_id UUID,
        action_type TEXT NOT NULL,
        target_user_id UUID,
        target_content_id UUID,
        details JSONB DEFAULT '{}'::jsonb,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
        priority TEXT NOT NULL DEFAULT 'low',
        is_read BOOLEAN NOT NULL DEFAULT false,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE saved_searches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        filters JSONB DEFAULT '{}'::jsonb,
        is_public BOOLEAN DEFAULT false NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS duplicate_pairs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_id_1 UUID NOT NULL,
        content_id_2 UUID NOT NULL,
        similarity_type TEXT NOT NULL,
        similarity_score NUMERIC,
        resolution TEXT DEFAULT 'pending' NOT NULL,
        detected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(content_id_1, content_id_2)
      )`,
      `CREATE TABLE IF NOT EXISTS user_consent (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        consent_type TEXT NOT NULL,
        granted BOOLEAN NOT NULL DEFAULT false,
        granted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        consent_version TEXT DEFAULT '1.0' NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE(user_id, consent_type)
      )`,
      `CREATE TABLE content_merge_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        primary_content_id UUID NOT NULL,
        merged_content_ids UUID[] NOT NULL,
        merged_by UUID,
        merge_reason TEXT,
        merged_metadata JSONB,
        can_undo BOOLEAN NOT NULL DEFAULT true,
        undo_deadline TIMESTAMPTZ,
        unmerged_at TIMESTAMPTZ,
        unmerged_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )`,
    ];

    for (const statement of simplifiedStatements) {
      await client.query(statement);
    }
  } finally {
    client.release();
  }

  return pool;
};

const ensureUser = async (
  repository: UserRepository,
  data: {
    username: string;
    email: string;
    isAdmin?: boolean;
    isAwsEmployee?: boolean;
  }
): Promise<User> => {
  const existing = await repository.findByUsername(data.username);
  if (existing) {
    return existing;
  }

  return repository.createUser({
    cognitoSub: `local-${randomUUID()}`,
    email: data.email,
    username: data.username,
    profileSlug: data.username,
    defaultVisibility: Visibility.PRIVATE,
    isAdmin: data.isAdmin ?? false,
    isAwsEmployee: data.isAwsEmployee ?? false,
  });
};

const ensureContent = async (
  repository: ContentRepository,
  pool: Pool,
  data: {
    title: string;
    userId: string;
    contentType: ContentType;
    visibility: Visibility;
    urls: string[];
    tags?: string[];
    description?: string;
    isClaimed?: boolean;
    originalAuthor?: string;
  }
): Promise<void> => {
  const existing = await pool.query('SELECT id FROM content WHERE title = $1 LIMIT 1', [data.title]);
  if (existing.rows.length > 0) {
    return;
  }

  await repository.createContent({
    userId: data.userId,
    title: data.title,
    description: data.description,
    contentType: data.contentType,
    visibility: data.visibility,
    publishDate: new Date(),
    urls: data.urls,
    tags: data.tags ?? [],
    isClaimed: data.isClaimed ?? true,
    originalAuthor: data.originalAuthor,
  });
};

const seedDatabase = async (pool: Pool): Promise<SeedState> => {
  const userRepository = new UserRepository(pool);
  const contentRepository = new ContentRepository(pool);

  const rawProjects = process.env.LOCAL_API_PROJECTS || 'default';
  const slugs = rawProjects.split(',').map((value) => normalizeSlug(value)).filter(Boolean);

  const projects = new Map<string, SeededProject>();
  for (const slug of slugs) {
    const creator = await ensureUser(userRepository, {
      username: `creator-${slug}`,
      email: `creator-${slug}@example.com`,
      isAdmin: false,
      isAwsEmployee: false,
    });
    const builder = await ensureUser(userRepository, {
      username: `builder-${slug}`,
      email: `builder-${slug}@example.com`,
      isAdmin: false,
      isAwsEmployee: false,
    });
    const admin = await ensureUser(userRepository, {
      username: `admin-${slug}`,
      email: `admin-${slug}@example.com`,
      isAdmin: true,
      isAwsEmployee: true,
    });

    projects.set(slug, { slug, creator, builder, admin });
    for (const contentType of Object.values(ContentType)) {
      await ensureContent(contentRepository, pool, {
        title: `Unclaimed ${slug} ${contentType}`,
        userId: builder.id,
        contentType,
        visibility: Visibility.PUBLIC,
        urls: [`https://example.com/${slug}/${contentType}`],
        tags: [contentType, slug],
        isClaimed: false,
        originalAuthor: creator.username,
        description: `Unclaimed ${contentType} content from ${slug}.`,
      });
    }
  }

  const publicUser = await ensureUser(userRepository, {
    username: 'public',
    email: 'public@example.com',
    isAdmin: false,
    isAwsEmployee: false,
  });

  await ensureContent(contentRepository, pool, {
    title: 'AWS Lambda Deep Dive',
    userId: publicUser.id,
    contentType: ContentType.BLOG,
    visibility: Visibility.PUBLIC,
    urls: ['https://example.com/aws-lambda-deep-dive'],
    tags: ['lambda', 'serverless', 'aws'],
    description: 'Deep dive into serverless application patterns for AWS Lambda.',
    isClaimed: true,
    originalAuthor: 'AWS Community',
  });

  return { projects };
};

const getUserForRequest = (seedState: SeedState, request: Request): User | null => {
  const token = parseAuthToken(request);
  const parsed = parseToken(token);
  if (!parsed) {
    return null;
  }
  const project = seedState.projects.get(parsed.slug);
  if (!project) {
    return null;
  }
  return parsed.role === 'admin' ? project.admin : project.creator;
};

const handleLambda = async (
  handler: LambdaHandler,
  seedState: SeedState,
  request: Request,
  response: Response
): Promise<void> => {
  const user = getUserForRequest(seedState, request);
  const authorizer = buildAuthorizer(user);
  const event = createEvent(request, authorizer);
  const context = createContext();
  const result = await handler(event, context);
  sendLambdaResponse(response, result, request.headers.origin);
};

const startServer = async (): Promise<void> => {
  const port = Number(process.env.PORT || process.env.LOCAL_API_PORT || 3001);
  const useExternalDb = Boolean(process.env.DATABASE_URL || process.env.LOCAL_PG_URL);

  let pool: Pool;
  if (useExternalDb) {
    process.env.TEST_DB_INMEMORY = 'false';
    const connectionString = process.env.DATABASE_URL || process.env.LOCAL_PG_URL;
    pool = new Pool({ connectionString });
  } else {
    pool = await createInMemoryPool();
  }

  resetDatabaseCache();
  setTestDatabasePool(pool);

  const seedState = await seedDatabase(pool);

  const [
    authRegister,
    authVerifyEmail,
    authResendVerification,
    authForgotPassword,
    authResetPassword,
    searchHandler,
    statsHandler,
    contentList,
    contentCreate,
    contentUpdate,
    contentDelete,
    contentUnclaimed,
    contentClaim,
    channelCreate,
    channelList,
    channelUpdate,
    channelDelete,
    channelSync,
    adminUserManagement,
    adminBadges,
    adminModeration,
    analyticsUser,
    analyticsExport,
    analyticsTrack,
    exportCsv,
    exportHistory,
    userGetCurrent,
    userExport,
    userDelete,
  ] = await Promise.all([
    import('../lambdas/auth/register').then((mod) => mod.handler),
    import('../lambdas/auth/verify-email').then((mod) => mod.handler),
    import('../lambdas/auth/resend-verification').then((mod) => mod.handler),
    import('../lambdas/auth/forgot-password').then((mod) => mod.handler),
    import('../lambdas/auth/reset-password').then((mod) => mod.handler),
    import('../lambdas/search/search').then((mod) => mod.handler),
    import('../lambdas/stats/platform-stats').then((mod) => mod.handler),
    import('../lambdas/content/list').then((mod) => mod.handler),
    import('../lambdas/content/create').then((mod) => mod.handler),
    import('../lambdas/content/update').then((mod) => mod.handler),
    import('../lambdas/content/delete').then((mod) => mod.handler),
    import('../lambdas/content/unclaimed').then((mod) => mod.handler),
    import('../lambdas/content/claim').then((mod) => mod.handler),
    import('../lambdas/channels/create').then((mod) => mod.handler),
    import('../lambdas/channels/list').then((mod) => mod.handler),
    import('../lambdas/channels/update').then((mod) => mod.handler),
    import('../lambdas/channels/delete').then((mod) => mod.handler),
    import('../lambdas/channels/sync').then((mod) => mod.handler),
    import('../lambdas/admin/user-management').then((mod) => mod.handler),
    import('../lambdas/admin/badges').then((mod) => mod.handler),
    import('../lambdas/admin/moderate-content').then((mod) => mod.handler),
    import('../lambdas/analytics/user-analytics').then((mod) => mod.handler),
    import('../lambdas/analytics/export-analytics').then((mod) => mod.handler),
    import('../lambdas/analytics/track-event').then((mod) => mod.handler),
    import('../lambdas/export/csv-export').then((mod) => mod.handler),
    import('../lambdas/export/history').then((mod) => mod.handler),
    import('../lambdas/users/get-current').then((mod) => mod.handler),
    import('../lambdas/users/export-data').then((mod) => mod.handler),
    import('../lambdas/users/delete-account').then((mod) => mod.handler),
  ]);

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.options(/.*/, (req, res) => {
    res.set(createCorsResponse(req.headers.origin)).status(200).send('');
  });

  app.post('/auth/register', (req, res) => handleLambda(authRegister, seedState, req, res));
  app.post('/auth/verify-email', (req, res) => handleLambda(authVerifyEmail, seedState, req, res));
  app.post('/auth/resend-verification', (req, res) => handleLambda(authResendVerification, seedState, req, res));
  app.post('/auth/forgot-password', (req, res) => handleLambda(authForgotPassword, seedState, req, res));
  app.post('/auth/reset-password', (req, res) => handleLambda(authResetPassword, seedState, req, res));

  app.get('/search', (req, res) => handleLambda(searchHandler, seedState, req, res));
  app.get('/stats', (req, res) => handleLambda(statsHandler, seedState, req, res));

  app.get('/content', (req, res) => handleLambda(contentList, seedState, req, res));
  app.post('/content', (req, res) => handleLambda(contentCreate, seedState, req, res));
  app.put('/content/:id', (req, res) => handleLambda(contentUpdate, seedState, req, res));
  app.delete('/content/:id', (req, res) => handleLambda(contentDelete, seedState, req, res));
  app.get('/content/unclaimed', (req, res) => handleLambda(contentUnclaimed, seedState, req, res));
  app.post('/content/:id/claim', (req, res) => handleLambda(contentClaim, seedState, req, res));
  app.post('/content/bulk-claim', (req, res) => handleLambda(contentClaim, seedState, req, res));

  app.get('/channels', (req, res) => handleLambda(channelList, seedState, req, res));
  app.post('/channels', (req, res) => handleLambda(channelCreate, seedState, req, res));
  app.put('/channels/:id', (req, res) => handleLambda(channelUpdate, seedState, req, res));
  app.delete('/channels/:id', (req, res) => handleLambda(channelDelete, seedState, req, res));
  app.post('/channels/:id/sync', (req, res) => handleLambda(channelSync, seedState, req, res));

  app.get('/admin/users', (req, res) => handleLambda(adminUserManagement, seedState, req, res));
  app.get('/admin/users/:id', (req, res) => handleLambda(adminUserManagement, seedState, req, res));
  app.post('/admin/users/export', (req, res) => handleLambda(adminUserManagement, seedState, req, res));

  app.post('/admin/badges', (req, res) => handleLambda(adminBadges, seedState, req, res));
  app.post('/admin/badges/bulk', (req, res) => handleLambda(adminBadges, seedState, req, res));
  app.delete('/admin/badges', (req, res) => handleLambda(adminBadges, seedState, req, res));
  app.put('/admin/users/:id/aws-employee', (req, res) => handleLambda(adminBadges, seedState, req, res));
  app.get('/users/:id/badges', (req, res) => handleLambda(adminBadges, seedState, req, res));
  app.get('/admin/content/flagged', (req, res) => handleLambda(adminModeration, seedState, req, res));

  app.get('/analytics/user', (req, res) => handleLambda(analyticsUser, seedState, req, res));
  app.post('/analytics/export', (req, res) => handleLambda(analyticsExport, seedState, req, res));
  app.post('/analytics/track', (req, res) => handleLambda(analyticsTrack, seedState, req, res));

  app.post('/export/csv', (req, res) => handleLambda(exportCsv, seedState, req, res));
  app.get('/export/history', (req, res) => handleLambda(exportHistory, seedState, req, res));

  app.get('/users/me', (req, res) => handleLambda(userGetCurrent, seedState, req, res));
  app.get('/users/:id/export', (req, res) => handleLambda(userExport, seedState, req, res));
  app.delete('/users/:id', (req, res) => handleLambda(userDelete, seedState, req, res));

  app.all(/.*/, (req, res) => {
    const headers = createCorsResponse(req.headers.origin);
    res.status(404).set(headers).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.path}`,
      },
    });
  });

  const server = app.listen(port, () => {
    console.log(`Local backend server listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close();
    await closeDatabasePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

startServer().catch((error) => {
  console.error('Failed to start local backend server:', error);
  process.exit(1);
});
