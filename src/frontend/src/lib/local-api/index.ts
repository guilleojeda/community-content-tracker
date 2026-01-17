/* istanbul ignore file */
import {
  Badge,
  BadgeType,
  Channel,
  ChannelType,
  Content,
  ContentType,
  ExportHistoryEntry,
  ExportHistoryResponse,
  PlatformStats,
  TriggerSyncResponse,
  User,
  UserDataExport,
  Visibility,
  AdminDashboardStats,
  SystemHealthStatus,
} from '@shared/types';

export interface LocalApiRequest {
  method: string;
  path: string[];
  query: URLSearchParams;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface LocalApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  isJson?: boolean;
}

type Role = 'admin' | 'creator' | 'builder';

interface LocalAuditLogEntry {
  id: string;
  adminUser: { id: string; username: string | null; email: string | null };
  actionType: string;
  targetUser: { id: string; username: string | null; email: string | null } | null;
  targetContentId?: string | null;
  details: Record<string, any> | null;
  ipAddress: string | null;
  createdAt: Date;
}

interface LocalApiState {
  usersById: Map<string, User>;
  usersByUsername: Map<string, string>;
  badgesByUserId: Map<string, Badge[]>;
  contentByUserId: Map<string, Content[]>;
  channelsByUserId: Map<string, Channel[]>;
  unclaimedBySlug: Map<string, Content[]>;
  exportHistoryByUserId: Map<string, ExportHistoryEntry[]>;
  auditLog: LocalAuditLogEntry[];
  publicContent: Content[];
}

const TOKEN_PATTERN = /^(admin|test)-token-(.+)$/i;

const normalizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isValidContentType = (value: string | null): value is ContentType =>
  value !== null && Object.values(ContentType).includes(value as ContentType);

const isValidVisibility = (value: string | null): value is Visibility =>
  value !== null && Object.values(Visibility).includes(value as Visibility);

const isValidBadgeType = (value: string | null): value is BadgeType =>
  value !== null && Object.values(BadgeType).includes(value as BadgeType);

const buildUser = (slug: string, role: Role, overrides: Partial<User> = {}): User => {
  const now = new Date();
  const username = overrides.username ?? `${role}-${slug}`;
  const email = overrides.email ?? `${role}-${slug}@example.com`;
  return {
    id: overrides.id ?? `user-${slug}-${role}`,
    cognitoSub: overrides.cognitoSub ?? `cognito-${slug}-${role}`,
    email,
    username,
    profileSlug: overrides.profileSlug ?? username,
    bio: overrides.bio,
    socialLinks: overrides.socialLinks,
    defaultVisibility: overrides.defaultVisibility ?? Visibility.PUBLIC,
    isAdmin: overrides.isAdmin ?? role === 'admin',
    isAwsEmployee: overrides.isAwsEmployee ?? role === 'admin',
    mfaEnabled: overrides.mfaEnabled,
    receiveNewsletter: overrides.receiveNewsletter,
    receiveContentNotifications: overrides.receiveContentNotifications,
    receiveCommunityUpdates: overrides.receiveCommunityUpdates,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

const buildContent = (payload: {
  id: string;
  userId: string;
  title: string;
  description?: string;
  contentType: ContentType;
  visibility: Visibility;
  urls: string[];
  tags?: string[];
  isClaimed?: boolean;
  originalAuthor?: string;
  publishDate?: Date;
}): Content => {
  const now = new Date();
  return {
    id: payload.id,
    userId: payload.userId,
    title: payload.title,
    description: payload.description,
    contentType: payload.contentType,
    visibility: payload.visibility,
    publishDate: payload.publishDate,
    captureDate: now,
    metrics: { views: 1200, likes: 245 },
    tags: payload.tags ?? [],
    isClaimed: payload.isClaimed ?? true,
    originalAuthor: payload.originalAuthor,
    urls: payload.urls.map(url => ({ id: createId('url'), url })),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
};

const buildExportEntry = (
  exportType: ExportHistoryEntry['exportType'],
  params: ExportHistoryEntry['parameters']
): ExportHistoryEntry => ({
  id: createId('export'),
  exportType,
  exportFormat: 'csv',
  rowCount: 25,
  createdAt: new Date(),
  parameters: params,
});

const createInitialState = (): LocalApiState => {
  const publicContent: Content[] = [
    buildContent({
      id: 'public-lambda-deep-dive',
      userId: 'user-public',
      title: 'AWS Lambda Deep Dive',
      description: 'Deep dive into serverless application patterns for AWS Lambda.',
      contentType: ContentType.BLOG,
      visibility: Visibility.PUBLIC,
      urls: ['https://example.com/aws-lambda-deep-dive'],
      tags: ['lambda', 'serverless', 'aws'],
      isClaimed: true,
      originalAuthor: 'AWS Community',
    }),
  ];

  return {
    usersById: new Map(),
    usersByUsername: new Map(),
    badgesByUserId: new Map(),
    contentByUserId: new Map(),
    channelsByUserId: new Map(),
    unclaimedBySlug: new Map(),
    exportHistoryByUserId: new Map(),
    auditLog: [],
    publicContent,
  };
};

let state = createInitialState();

export const resetLocalApiState = (): void => {
  state = createInitialState();
};

const getHeader = (
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry ? entry[1] : undefined;
};

const getAuthToken = (headers?: Record<string, string | undefined>): string | null => {
  const raw = getHeader(headers, 'authorization');
  if (!raw) {
    return null;
  }
  return raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
};

const parseToken = (token?: string | null): { slug: string; role: Role } | null => {
  if (!token) {
    return null;
  }
  const match = token.match(TOKEN_PATTERN);
  if (!match) {
    return { slug: 'default', role: 'creator' };
  }
  const role = match[1].toLowerCase() === 'admin' ? 'admin' : 'creator';
  return { slug: normalizeSlug(match[2]), role };
};

const ensureUser = (slug: string, role: Role, overrides: Partial<User> = {}): User => {
  const username = overrides.username ?? `${role}-${slug}`;
  const existingId = state.usersByUsername.get(username);
  if (existingId) {
    return state.usersById.get(existingId)!;
  }
  const user = buildUser(slug, role, overrides);
  state.usersById.set(user.id, user);
  state.usersByUsername.set(user.username, user.id);
  state.badgesByUserId.set(user.id, []);
  state.contentByUserId.set(user.id, []);
  state.channelsByUserId.set(user.id, []);
  state.exportHistoryByUserId.set(user.id, []);
  return user;
};

const ensureProjectUsers = (slug: string): { creator: User; builder: User; admin: User } => {
  const creator = ensureUser(slug, 'creator');
  const builder = ensureUser(slug, 'builder');
  const admin = ensureUser(slug, 'admin');
  return { creator, builder, admin };
};

const getUserForToken = (token: string | null): User | null => {
  const parsed = parseToken(token);
  if (!parsed) {
    return null;
  }
  const users = ensureProjectUsers(parsed.slug);
  return parsed.role === 'admin' ? users.admin : users.creator;
};

const getUserById = (userId: string): User | null =>
  state.usersById.get(userId) ?? null;

const getUserBadges = (userId: string): Badge[] =>
  state.badgesByUserId.get(userId) ?? [];

const addAuditLogEntry = (entry: LocalAuditLogEntry): void => {
  state.auditLog.unshift(entry);
};

const appendExportHistory = (userId: string, entry: ExportHistoryEntry): void => {
  const history = state.exportHistoryByUserId.get(userId) ?? [];
  history.unshift(entry);
  state.exportHistoryByUserId.set(userId, history);
};

const ensureUnclaimedContent = (slug: string): Content[] => {
  const existing = state.unclaimedBySlug.get(slug);
  if (existing) {
    return existing;
  }
  const { builder } = ensureProjectUsers(slug);
  const items = Object.values(ContentType).map((contentType) =>
    buildContent({
      id: `unclaimed-${slug}-${contentType}`,
      userId: builder.id,
      title: `Unclaimed ${slug} ${contentType}`,
      description: `Unclaimed ${contentType} content from ${slug}.`,
      contentType,
      visibility: Visibility.PUBLIC,
      urls: [`https://example.com/${slug}/${contentType}`],
      tags: [contentType, slug],
      isClaimed: false,
      originalAuthor: builder.username,
    })
  );
  state.unclaimedBySlug.set(slug, items);
  return items;
};

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>): LocalApiResponse => ({
  status,
  body,
  headers,
  isJson: true,
});

const textResponse = (body: string, status = 200, headers?: Record<string, string>): LocalApiResponse => ({
  status,
  body,
  headers,
  isJson: false,
});

const errorResponse = (status: number, code: string, message: string): LocalApiResponse =>
  jsonResponse({ error: { code, message } }, status);

const parseNumber = (value: string | null, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const applyPagination = <T>(items: T[], limit: number, offset: number): T[] =>
  items.slice(offset, offset + limit);

export const handleLocalApiRequest = (request: LocalApiRequest): LocalApiResponse => {
  const method = request.method.toUpperCase();
  const [resource, ...segments] = request.path;

  if (!resource) {
    return errorResponse(404, 'NOT_FOUND', 'Missing resource path');
  }

  if (resource === 'auth') {
    if (method === 'POST' && segments[0] === 'register') {
      const payload = request.body as { email?: string; username?: string } | undefined;
      if (!payload?.email || !payload?.username) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Email and username are required');
      }
      const slug = normalizeSlug(payload.username);
      const user = ensureUser(slug, 'creator', {
        id: createId('user'),
        email: payload.email,
        username: payload.username,
        profileSlug: payload.username,
      });
      return jsonResponse({ userId: user.id, message: 'Registration successful' });
    }
    if (method === 'POST' && segments[0] === 'verify-email') {
      return jsonResponse({ message: 'Email verified successfully', verified: true });
    }
    if (method === 'POST' && segments[0] === 'resend-verification') {
      return jsonResponse({ message: 'Verification email sent' });
    }
    if (method === 'POST' && segments[0] === 'forgot-password') {
      const payload = request.body as { email?: string } | undefined;
      if (!payload?.email) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Email is required');
      }
      return jsonResponse({ message: 'If an account with that email exists, a password reset code has been sent' });
    }
    if (method === 'POST' && segments[0] === 'reset-password') {
      const payload = request.body as { email?: string; confirmationCode?: string; newPassword?: string } | undefined;
      if (!payload?.email || !payload?.confirmationCode || !payload?.newPassword) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Email, confirmation code, and new password are required');
      }
      return jsonResponse({ message: 'Password reset successful' });
    }
    return errorResponse(404, 'NOT_FOUND', 'Auth endpoint not available');
  }

  if (resource === 'search' && method === 'GET' && segments.length === 0) {
    const query = (request.query.get('q') ?? request.query.get('query') ?? '').toLowerCase();
    let items = [...state.publicContent];
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    if (user) {
      items = items.concat(state.contentByUserId.get(user.id) ?? []);
    }
    if (query) {
      items = items.filter(item =>
        item.title.toLowerCase().includes(query) ||
        (item.description ?? '').toLowerCase().includes(query) ||
        item.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    const limit = parseNumber(request.query.get('limit'), items.length);
    const offset = parseNumber(request.query.get('offset'), 0);
    const paged = applyPagination(items, limit, offset);
    return jsonResponse({ items: paged, total: items.length, limit, offset });
  }

  if (resource === 'stats' && method === 'GET') {
    const totalUsers = state.usersById.size || 1;
    const totalContent = Array.from(state.contentByUserId.values()).reduce((acc, list) => acc + list.length, 0)
      + state.publicContent.length;
    const contentByType = Object.values(ContentType).reduce((acc, type) => {
      acc[type] = state.publicContent.filter(item => item.contentType === type).length;
      return acc;
    }, {} as Record<string, number>);

    const stats: PlatformStats = {
      totalUsers,
      totalContent,
      topContributors: Math.max(1, Math.min(5, totalUsers)),
      contentByType,
      recentActivity: { last24h: 8, last7d: 42, last30d: 128 },
      uptime: '99.99%',
      lastUpdated: new Date().toISOString(),
    };
    return jsonResponse(stats);
  }

  if (resource === 'content') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    const slug = parseToken(token)?.slug ?? 'public';

    if (segments[0] === 'unclaimed' && method === 'GET') {
      let items = ensureUnclaimedContent(slug);
      const contentType = request.query.get('contentType');
      if (isValidContentType(contentType)) {
        items = items.filter(item => item.contentType === contentType);
      }
      const searchQuery = request.query.get('query');
      if (searchQuery) {
        const lower = searchQuery.toLowerCase();
        items = items.filter(item => item.title.toLowerCase().includes(lower));
      }
      return jsonResponse({ content: items, total: items.length });
    }

    if (!user) {
      return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    if (segments.length === 0 && method === 'GET') {
      let items = state.contentByUserId.get(user.id) ?? [];
      const contentType = request.query.get('contentType');
      const visibility = request.query.get('visibility');
      const tags = request.query.get('tags');

      if (isValidContentType(contentType)) {
        items = items.filter(item => item.contentType === contentType);
      }
      if (isValidVisibility(visibility)) {
        items = items.filter(item => item.visibility === visibility);
      }
      if (tags) {
        const tagList = tags.split(',').map(tag => tag.trim()).filter(Boolean);
        if (tagList.length > 0) {
          items = items.filter(item => tagList.every(tag => item.tags.includes(tag)));
        }
      }
      return jsonResponse({ content: items, total: items.length });
    }

    if (segments.length === 0 && method === 'POST') {
      const payload = request.body as { title?: string; contentType?: string; visibility?: string; urls?: string[]; tags?: string[]; description?: string } | undefined;
      if (!payload?.title || !payload?.contentType || !payload?.urls?.length) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Title, content type, and urls are required');
      }
      const contentType = isValidContentType(payload.contentType)
        ? payload.contentType
        : ContentType.BLOG;
      const visibility = isValidVisibility(payload.visibility ?? null)
        ? (payload.visibility as Visibility)
        : Visibility.PUBLIC;
      const content = buildContent({
        id: createId('content'),
        userId: user.id,
        title: payload.title,
        description: payload.description,
        contentType,
        visibility,
        urls: payload.urls,
        tags: payload.tags,
        isClaimed: true,
      });
      const list = state.contentByUserId.get(user.id) ?? [];
      list.unshift(content);
      state.contentByUserId.set(user.id, list);
      return jsonResponse(content);
    }

    if (segments[0] === 'bulk-update-visibility' && method === 'POST') {
      const payload = request.body as { contentIds?: string[]; visibility?: string } | undefined;
      const contentIds = payload?.contentIds ?? [];
      const visibility = isValidVisibility(payload?.visibility ?? null) ? payload?.visibility as Visibility : null;
      if (!visibility) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Visibility is required');
      }
      const items = state.contentByUserId.get(user.id) ?? [];
      let updated = 0;
      items.forEach(item => {
        if (contentIds.includes(item.id)) {
          item.visibility = visibility;
          item.updatedAt = new Date();
          updated += 1;
        }
      });
      return jsonResponse({ updated });
    }

    if (segments[0] === 'bulk-claim' && method === 'POST') {
      const payload = request.body as { contentIds?: string[] } | undefined;
      const contentIds = payload?.contentIds ?? [];
      const unclaimed = ensureUnclaimedContent(slug);
      const errors: { contentId: string; error: string }[] = [];
      let claimed = 0;
      contentIds.forEach(contentId => {
        const index = unclaimed.findIndex(item => item.id === contentId);
        if (index === -1) {
          errors.push({ contentId, error: 'Not found' });
          return;
        }
        const [item] = unclaimed.splice(index, 1);
        const claimedItem = { ...item, userId: user.id, isClaimed: true, updatedAt: new Date() };
        const list = state.contentByUserId.get(user.id) ?? [];
        list.unshift(claimedItem);
        state.contentByUserId.set(user.id, list);
        claimed += 1;
      });
      return jsonResponse({
        success: errors.length === 0,
        claimed,
        failed: errors.length,
        errors: errors.length ? errors : undefined,
      });
    }

    if (segments.length === 2 && segments[1] === 'claim' && method === 'POST') {
      const contentId = segments[0];
      const unclaimed = ensureUnclaimedContent(slug);
      const index = unclaimed.findIndex(item => item.id === contentId);
      if (index === -1) {
        return errorResponse(404, 'NOT_FOUND', 'Content not found');
      }
      const [item] = unclaimed.splice(index, 1);
      const claimedItem = { ...item, userId: user.id, isClaimed: true, updatedAt: new Date() };
      const list = state.contentByUserId.get(user.id) ?? [];
      list.unshift(claimedItem);
      state.contentByUserId.set(user.id, list);
      return jsonResponse({ success: true, content: claimedItem });
    }

    if (segments.length === 1 && method === 'PUT') {
      const contentId = segments[0];
      const payload = request.body as { title?: string; contentType?: string; visibility?: string; urls?: string[]; tags?: string[]; description?: string } | undefined;
      const list = state.contentByUserId.get(user.id) ?? [];
      const item = list.find(entry => entry.id === contentId);
      if (!item) {
        return errorResponse(404, 'NOT_FOUND', 'Content not found');
      }
      if (payload?.title) item.title = payload.title;
      if (payload?.description !== undefined) item.description = payload.description;
      if (isValidContentType(payload?.contentType ?? null)) item.contentType = payload!.contentType as ContentType;
      if (isValidVisibility(payload?.visibility ?? null)) item.visibility = payload!.visibility as Visibility;
      if (payload?.tags) item.tags = payload.tags;
      if (payload?.urls) item.urls = payload.urls.map(url => ({ id: createId('url'), url }));
      item.updatedAt = new Date();
      return jsonResponse(item);
    }

    if (segments.length === 1 && method === 'DELETE') {
      const contentId = segments[0];
      const list = state.contentByUserId.get(user.id) ?? [];
      const remaining = list.filter(entry => entry.id !== contentId);
      state.contentByUserId.set(user.id, remaining);
      return jsonResponse({ success: true });
    }
  }

  if (resource === 'channels') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    if (!user) {
      return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }
    const channels = state.channelsByUserId.get(user.id) ?? [];

    if (segments.length === 0 && method === 'GET') {
      return jsonResponse({ channels, total: channels.length });
    }

    if (segments.length === 0 && method === 'POST') {
      const payload = request.body as { channelType?: string; url?: string; name?: string; syncFrequency?: string; metadata?: Record<string, any> } | undefined;
      if (!payload?.channelType || !payload?.url) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Channel type and url are required');
      }
      const channelType = Object.values(ChannelType).includes(payload.channelType as ChannelType)
        ? payload.channelType as ChannelType
        : ChannelType.BLOG;
      const channel: Channel = {
        id: createId('channel'),
        userId: user.id,
        channelType,
        url: payload.url,
        name: payload.name,
        enabled: true,
        syncFrequency: (payload.syncFrequency as Channel['syncFrequency']) ?? 'weekly',
        metadata: payload.metadata ?? { verified: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      channels.unshift(channel);
      state.channelsByUserId.set(user.id, channels);
      return jsonResponse(channel);
    }

    if (segments.length === 2 && segments[1] === 'sync' && method === 'POST') {
      const channel = channels.find(item => item.id === segments[0]);
      if (!channel) {
        return errorResponse(404, 'NOT_FOUND', 'Channel not found');
      }
      channel.lastSyncAt = new Date();
      channel.lastSyncStatus = 'success';
      channel.lastSyncError = undefined;
      channel.updatedAt = new Date();
      const response: TriggerSyncResponse = {
        message: 'Sync started successfully',
        syncJobId: createId('sync'),
      };
      return jsonResponse(response);
    }

    if (segments.length === 1 && method === 'PUT') {
      const channel = channels.find(item => item.id === segments[0]);
      if (!channel) {
        return errorResponse(404, 'NOT_FOUND', 'Channel not found');
      }
      const payload = request.body as { name?: string; enabled?: boolean; syncFrequency?: string; metadata?: Record<string, any> } | undefined;
      if (payload?.name !== undefined) channel.name = payload.name;
      if (payload?.enabled !== undefined) channel.enabled = payload.enabled;
      if (payload?.syncFrequency) channel.syncFrequency = payload.syncFrequency as Channel['syncFrequency'];
      if (payload?.metadata) channel.metadata = payload.metadata;
      channel.updatedAt = new Date();
      return jsonResponse(channel);
    }

    if (segments.length === 1 && method === 'DELETE') {
      state.channelsByUserId.set(user.id, channels.filter(item => item.id !== segments[0]));
      return jsonResponse({ success: true });
    }
  }

  if (resource === 'analytics') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    if (!user) {
      return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    if (segments[0] === 'user' && method === 'GET') {
      const content = state.contentByUserId.get(user.id) ?? [];
      const contentByType = content.reduce((acc, item) => {
        acc[item.contentType] = (acc[item.contentType] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const tagCounts = content.reduce((acc, item) => {
        item.tags.forEach(tag => {
          acc[tag] = (acc[tag] ?? 0) + 1;
        });
        return acc;
      }, {} as Record<string, number>);
      const topTags = Object.entries(tagCounts)
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count }));
      const topContent = content.slice(0, 5).map(item => ({
        id: item.id,
        title: item.title,
        contentType: item.contentType,
        views: 120 + Math.floor(Math.random() * 1000),
      }));
      const today = new Date();
      const timeSeries = Array.from({ length: 5 }).map((_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - index);
        return { date: date.toISOString().split('T')[0], views: 100 + index * 12 };
      }).reverse();

      const startDate = request.query.get('startDate');
      const endDate = request.query.get('endDate');
      const groupBy = request.query.get('groupBy') ?? 'day';

      return jsonResponse({
        contentByType,
        topTags,
        topContent,
        timeSeries,
        dateRange: startDate && endDate ? { startDate, endDate } : null,
        groupBy,
      });
    }

    if (segments[0] === 'export' && method === 'POST') {
      const entry = buildExportEntry('analytics', {
        groupBy: request.body && typeof request.body === 'object' ? (request.body as { groupBy?: string }).groupBy ?? null : null,
      });
      appendExportHistory(user.id, entry);
      return textResponse(
        `id,generated_at\nanalytics,${new Date().toISOString()}\n`,
        200,
        {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="analytics-export.csv"',
        }
      );
    }

    if (segments[0] === 'track' && method === 'POST') {
      return jsonResponse({ success: true });
    }
  }

  if (resource === 'export') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    if (!user) {
      return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    if (segments[0] === 'csv' && method === 'POST') {
      const payload = request.body as { programType?: string; startDate?: string; endDate?: string } | undefined;
      const entry = buildExportEntry('program', {
        programType: payload?.programType ?? null,
        startDate: payload?.startDate ?? null,
        endDate: payload?.endDate ?? null,
      });
      appendExportHistory(user.id, entry);
      return textResponse(
        `program_type,generated_at\n${payload?.programType ?? 'community_builder'},${new Date().toISOString()}\n`,
        200,
        {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="program-export.csv"',
        }
      );
    }

    if (segments[0] === 'history' && method === 'GET') {
      const history = state.exportHistoryByUserId.get(user.id) ?? [];
      const limit = parseNumber(request.query.get('limit'), history.length || 10);
      const offset = parseNumber(request.query.get('offset'), 0);
      const paged = applyPagination(history, limit, offset);
      const response: ExportHistoryResponse = {
        history: paged,
        total: history.length,
        limit,
        offset,
      };
      return jsonResponse(response);
    }
  }

  if (resource === 'users') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);

    if (segments[0] === 'me' && method === 'GET') {
      if (!user) {
        return errorResponse(401, 'AUTH_REQUIRED', 'Authentication required');
      }
      return jsonResponse(user);
    }

    if (segments[0] === 'username' && segments[1] && method === 'GET') {
      const username = segments[1];
      const userId = state.usersByUsername.get(username);
      if (!userId) {
        return errorResponse(404, 'NOT_FOUND', 'User not found');
      }
      const record = getUserById(userId);
      if (!record) {
        return errorResponse(404, 'NOT_FOUND', 'User not found');
      }
      return jsonResponse({ user: record });
    }

    if (!segments[0]) {
      return errorResponse(404, 'NOT_FOUND', 'User endpoint not found');
    }

    const userId = segments[0] === 'me' ? user?.id : segments[0];
    if (!userId || !getUserById(userId)) {
      return errorResponse(404, 'NOT_FOUND', 'User not found');
    }

    if (segments[1] === 'badges' && method === 'GET') {
      return jsonResponse({ badges: getUserBadges(userId) });
    }

    if (segments[1] === 'content' && method === 'GET') {
      const content = state.contentByUserId.get(userId) ?? [];
      const visibility = request.query.get('visibility');
      const filtered = isValidVisibility(visibility) ? content.filter(item => item.visibility === visibility) : content;
      return jsonResponse({ content: filtered, total: filtered.length });
    }

    if (segments[1] === 'export' && method === 'GET') {
      const exportPayload: UserDataExport = {
        user: getUserById(userId)!,
        content: state.contentByUserId.get(userId) ?? [],
        badges: getUserBadges(userId),
        channels: state.channelsByUserId.get(userId) ?? [],
        bookmarks: [],
        follows: { following: [], followers: [] },
        consents: [],
        exportDate: new Date().toISOString(),
      };
      return jsonResponse(exportPayload);
    }

    if (segments[1] === 'preferences' && method === 'PATCH') {
      return jsonResponse({ message: 'Preferences updated successfully.' });
    }

    if (segments[1] === 'mfa' && segments[2] === 'setup' && method === 'POST') {
      return jsonResponse({ qrCode: 'data:image/png;base64,local', secret: 'LOCAL-SECRET' });
    }

    if (segments.length === 1 && method === 'PATCH') {
      const payload = request.body as Partial<User> | undefined;
      const target = getUserById(userId)!;
      if (payload?.email) target.email = payload.email;
      if (payload?.username) target.username = payload.username;
      if (payload?.bio !== undefined) target.bio = payload.bio;
      if (payload?.defaultVisibility) target.defaultVisibility = payload.defaultVisibility;
      if (payload?.socialLinks) target.socialLinks = payload.socialLinks;
      target.updatedAt = new Date();
      return jsonResponse({ user: target });
    }

    if (segments.length === 1 && method === 'DELETE') {
      state.usersById.delete(userId);
      state.badgesByUserId.delete(userId);
      state.contentByUserId.delete(userId);
      state.channelsByUserId.delete(userId);
      state.exportHistoryByUserId.delete(userId);
      return jsonResponse({ message: 'Account deleted successfully.' });
    }
  }

  if (resource === 'admin') {
    const token = getAuthToken(request.headers);
    const user = getUserForToken(token);
    const slug = parseToken(token)?.slug ?? 'default';
    if (!user || !user.isAdmin) {
      return errorResponse(403, 'PERMISSION_DENIED', 'Admin access required');
    }
    const { builder, creator, admin } = ensureProjectUsers(slug);

    if (segments[0] === 'dashboard' && segments[1] === 'stats' && method === 'GET') {
      const users = [creator, builder, admin];
      const usersByBadgeType = Object.values(BadgeType).reduce((acc, badgeType) => {
        acc[badgeType] = users.filter(candidate => getUserBadges(candidate.id).some(badge => badge.badgeType === badgeType)).length;
        return acc;
      }, {} as Record<BadgeType, number>);
      const stats: AdminDashboardStats = {
        totalUsers: users.length,
        awsEmployees: users.filter(candidate => candidate.isAwsEmployee).length,
        usersByBadgeType,
        totalContent: state.publicContent.length,
        recentRegistrations: users.map(candidate => ({
          id: candidate.id,
          username: candidate.username,
          email: candidate.email,
          createdAt: candidate.createdAt,
        })),
        pendingBadgeCandidates: [],
        quickActions: {
          flaggedContentCount: 0,
          recentAdminActions: state.auditLog.length,
          usersWithoutBadges: users.filter(candidate => getUserBadges(candidate.id).length === 0).length,
          contentNeedingReview: 0,
        },
      };
      return jsonResponse(stats);
    }

    if (segments[0] === 'dashboard' && segments[1] === 'system-health' && method === 'GET') {
      const health: SystemHealthStatus = {
        database: 'healthy',
        connectionPool: {
          totalConnections: 5,
          activeConnections: 1,
          idleConnections: 3,
          waitingConnections: 0,
        },
        queryPerformance: {
          lastQueryMs: 42,
          avgQueryMs: 18,
        },
        lambda: {
          memoryUsedMB: 64,
          memoryLimitMB: 256,
        },
        timestamp: new Date().toISOString(),
      };
      return jsonResponse(health);
    }

    if (segments[0] === 'users' && segments.length === 1 && method === 'GET') {
      const allUsers = [creator, builder, admin];
      const search = request.query.get('search');
      const badgeFilter = request.query.get('badgeType');
      let filtered = allUsers;

      if (search) {
        const lower = search.toLowerCase();
        filtered = filtered.filter(candidate =>
          candidate.username.toLowerCase().includes(lower) ||
          candidate.email.toLowerCase().includes(lower)
        );
      }
      if (isValidBadgeType(badgeFilter)) {
        filtered = filtered.filter(candidate => getUserBadges(candidate.id).some(badge => badge.badgeType === badgeFilter));
      }

      const limit = parseNumber(request.query.get('limit'), 25);
      const offset = parseNumber(request.query.get('offset'), 0);
      const paged = applyPagination(filtered, limit, offset);

      return jsonResponse({
        users: paged.map(candidate => ({
          id: candidate.id,
          username: candidate.username,
          email: candidate.email,
          isAdmin: candidate.isAdmin,
          isAwsEmployee: candidate.isAwsEmployee,
          createdAt: candidate.createdAt,
        })),
        total: filtered.length,
        limit,
        offset,
      });
    }

    if (segments[0] === 'users' && segments[1] && method === 'GET') {
      const target = getUserById(segments[1]);
      if (!target) {
        return errorResponse(404, 'NOT_FOUND', 'User not found');
      }
      return jsonResponse({
        user: {
          id: target.id,
          username: target.username,
          email: target.email,
          isAdmin: target.isAdmin,
          isAwsEmployee: target.isAwsEmployee,
          createdAt: target.createdAt,
        },
        badges: getUserBadges(target.id).map(badge => ({
          badgeType: badge.badgeType,
          awardedAt: badge.awardedAt,
        })),
        contentCount: state.contentByUserId.get(target.id)?.length ?? 0,
      });
    }

    if (segments[0] === 'users' && segments[1] === 'export' && method === 'POST') {
      const entry = buildExportEntry('user_list', {});
      appendExportHistory(user.id, entry);
      return textResponse(
        'id,username,email\nuser-1,creator,creator@example.com\n',
        200,
        {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="users-export.csv"',
        }
      );
    }

    if (segments[0] === 'users' && segments[2] === 'aws-employee' && method === 'PUT') {
      const target = getUserById(segments[1]);
      if (!target) {
        return errorResponse(404, 'NOT_FOUND', 'User not found');
      }
      const payload = request.body as { isAwsEmployee?: boolean } | undefined;
      if (payload?.isAwsEmployee !== undefined) {
        target.isAwsEmployee = payload.isAwsEmployee;
        target.updatedAt = new Date();
      }
      return jsonResponse({ success: true });
    }

    if (segments[0] === 'badges' && method === 'POST') {
      const payload = request.body as { userId?: string; userIds?: string[]; badgeType?: BadgeType; reason?: string } | undefined;
      const targets = payload?.userIds ?? (payload?.userId ? [payload.userId] : []);
      if (!payload?.badgeType || targets.length === 0) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Badge type and user ids are required');
      }
      targets.forEach(targetId => {
        const target = getUserById(targetId);
        if (!target) {
          return;
        }
        const existing = getUserBadges(targetId);
        if (!existing.some(badge => badge.badgeType === payload.badgeType)) {
          const badge: Badge = {
            id: createId('badge'),
            userId: targetId,
            badgeType: payload.badgeType!,
            awardedAt: new Date(),
            awardedBy: user.id,
            awardedReason: payload.reason,
            metadata: {},
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          existing.push(badge);
          state.badgesByUserId.set(targetId, existing);
          addAuditLogEntry({
            id: createId('audit'),
            adminUser: { id: user.id, username: user.username, email: user.email },
            actionType: 'grant_badge',
            targetUser: { id: targetId, username: target.username, email: target.email },
            details: { badgeType: payload.badgeType },
            ipAddress: '127.0.0.1',
            createdAt: new Date(),
          });
        }
      });
      return jsonResponse({ success: true });
    }

    if (segments[0] === 'badges' && method === 'DELETE') {
      const payload = request.body as { userId?: string; badgeType?: BadgeType } | undefined;
      if (!payload?.userId || !payload.badgeType) {
        return errorResponse(400, 'VALIDATION_ERROR', 'User id and badge type are required');
      }
      const existing = getUserBadges(payload.userId).filter(badge => badge.badgeType !== payload.badgeType);
      state.badgesByUserId.set(payload.userId, existing);
      addAuditLogEntry({
        id: createId('audit'),
        adminUser: { id: user.id, username: user.username, email: user.email },
        actionType: 'revoke_badge',
        targetUser: { id: payload.userId, username: null, email: null },
        details: { badgeType: payload.badgeType },
        ipAddress: '127.0.0.1',
        createdAt: new Date(),
      });
      return jsonResponse({ success: true });
    }

    if (segments[0] === 'badges' && segments[1] === 'bulk' && method === 'POST') {
      const payload = request.body as { operation?: 'grant' | 'revoke'; userIds?: string[]; badgeType?: BadgeType; reason?: string } | undefined;
      if (!payload?.operation || !payload.badgeType || !payload.userIds?.length) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Operation, badge type, and user ids are required');
      }
      const failed: Array<{ userId: string; error: string }> = [];
      let successful = 0;
      payload.userIds.forEach(targetId => {
        if (!getUserById(targetId)) {
          failed.push({ userId: targetId, error: 'User not found' });
          return;
        }
        if (payload.operation === 'grant') {
          handleLocalApiRequest({
            method: 'POST',
            path: ['admin', 'badges'],
            query: new URLSearchParams(),
            headers: request.headers,
            body: { userId: targetId, badgeType: payload.badgeType, reason: payload.reason },
          });
        } else {
          handleLocalApiRequest({
            method: 'DELETE',
            path: ['admin', 'badges'],
            query: new URLSearchParams(),
            headers: request.headers,
            body: { userId: targetId, badgeType: payload.badgeType, reason: payload.reason },
          });
        }
        successful += 1;
      });
      return jsonResponse({
        operation: payload.operation,
        badgeType: payload.badgeType,
        successful,
        failed,
        summary: {
          total: payload.userIds.length,
          successful,
          failed: failed.length,
        },
      });
    }

    if (segments[0] === 'audit-log' && method === 'GET') {
      const limit = parseNumber(request.query.get('limit'), 20);
      const offset = parseNumber(request.query.get('offset'), 0);
      const paged = applyPagination(state.auditLog, limit, offset);
      return jsonResponse({
        entries: paged,
        pagination: {
          total: state.auditLog.length,
          limit,
          offset,
          hasMore: offset + limit < state.auditLog.length,
        },
      });
    }

    if (segments[0] === 'content' && segments[1] === 'flagged' && method === 'GET') {
      return jsonResponse({ content: [], total: 0, limit: 0, offset: 0 });
    }
  }

  return errorResponse(404, 'NOT_FOUND', 'Endpoint not implemented');
};
