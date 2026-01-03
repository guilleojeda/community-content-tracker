import { Page, Request } from '@playwright/test';

type MockState = {
  currentUser: Record<string, any>;
  content: Array<Record<string, any>>;
  unclaimed: Array<Record<string, any>>;
  channels: Array<Record<string, any>>;
  searchResults: { items: Array<Record<string, any>>; total: number; limit: number; offset: number };
  savedSearches: Array<Record<string, any>>;
  adminUsers: Array<Record<string, any>>;
  adminDetails: Record<string, Record<string, any>>;
  exportHistory: Array<Record<string, any>>;
  analytics: Record<string, any>;
};

const nowIso = () => new Date().toISOString();
const safePostDataJson = (request: Request): Record<string, any> => {
  try {
    return request.postDataJSON() as Record<string, any>;
  } catch {
    return {};
  }
};

const buildContent = (overrides: Partial<Record<string, any>> = {}) => {
  const id = overrides.id ?? `content-${Math.random().toString(36).slice(2, 8)}`;
  const title = overrides.title ?? 'Example Content';
  const url = overrides.url ?? `https://example.com/${id}`;
  const visibility = overrides.visibility ?? 'public';
  const tags = overrides.tags ?? ['aws'];
  const createdAt = overrides.createdAt ?? nowIso();
  return {
    id,
    userId: overrides.userId ?? 'user-1',
    title,
    description: overrides.description ?? 'Sample description',
    contentType: overrides.contentType ?? 'blog',
    visibility,
    publishDate: overrides.publishDate ?? createdAt,
    captureDate: overrides.captureDate ?? createdAt,
    metrics: overrides.metrics ?? { views: 10 },
    tags,
    isClaimed: overrides.isClaimed ?? true,
    originalAuthor: overrides.originalAuthor ?? null,
    urls: overrides.urls ?? [{ id: `${id}-url`, url }],
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    version: overrides.version ?? 1,
  };
};

const buildUser = (overrides: Partial<Record<string, any>> = {}) => {
  const createdAt = overrides.createdAt ?? nowIso();
  return {
    id: overrides.id ?? 'user-1',
    cognitoSub: overrides.cognitoSub ?? 'cognito-user-1',
    email: overrides.email ?? 'user@example.com',
    username: overrides.username ?? 'user1',
    profileSlug: overrides.profileSlug ?? 'user1',
    bio: overrides.bio ?? '',
    socialLinks: overrides.socialLinks ?? {},
    defaultVisibility: overrides.defaultVisibility ?? 'public',
    isAdmin: overrides.isAdmin ?? false,
    isAwsEmployee: overrides.isAwsEmployee ?? false,
    mfaEnabled: overrides.mfaEnabled ?? false,
    receiveNewsletter: overrides.receiveNewsletter ?? false,
    receiveContentNotifications: overrides.receiveContentNotifications ?? true,
    receiveCommunityUpdates: overrides.receiveCommunityUpdates ?? true,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  };
};

export const createMockState = (overrides: Partial<MockState> = {}): MockState => {
  const defaultUser = buildUser();
  const adminUser = buildUser({
    id: 'admin-1',
    email: 'admin@example.com',
    username: 'admin',
    profileSlug: 'admin',
    isAdmin: true,
  });

  const baseSearchContent = buildContent({
    id: 'search-1',
    title: 'AWS Lambda Deep Dive',
    contentType: 'blog',
    visibility: 'public',
    tags: ['serverless'],
  });

  const defaultState: MockState = {
    currentUser: defaultUser,
    content: [],
    unclaimed: [
      buildContent({
        id: 'unclaimed-1',
        title: 'Unclaimed Community Post',
        contentType: 'youtube',
        visibility: 'public',
        isClaimed: false,
      }),
    ],
    channels: [],
    searchResults: {
      items: [baseSearchContent],
      total: 1,
      limit: 10,
      offset: 0,
    },
    savedSearches: [],
    adminUsers: [
      {
        id: 'user-2',
        username: 'builder',
        email: 'builder@example.com',
        isAdmin: false,
        isAwsEmployee: false,
        createdAt: nowIso(),
      },
    ],
    adminDetails: {
      'user-2': {
        user: {
          id: 'user-2',
          username: 'builder',
          email: 'builder@example.com',
          isAdmin: false,
          isAwsEmployee: false,
          createdAt: nowIso(),
        },
        badges: [],
        contentCount: 3,
      },
    },
    exportHistory: [
      {
        id: 'export-1',
        userId: defaultUser.id,
        exportType: 'program',
        exportFormat: 'csv',
        parameters: { programType: 'community_builder' },
        createdAt: nowIso(),
      },
    ],
    analytics: {
      contentByType: { blog: 2, youtube: 1 },
      topTags: [{ tag: 'aws', count: 3 }],
      topContent: [
        { id: 'content-1', title: 'Serverless Guide', contentType: 'blog', views: 120 },
      ],
      timeSeries: [{ date: nowIso(), views: 12 }],
      dateRange: null,
      groupBy: 'day',
    },
  };

  const merged = {
    ...defaultState,
    ...overrides,
  };

  if (overrides.currentUser) {
    merged.currentUser = overrides.currentUser;
  }

  if (overrides.searchResults) {
    merged.searchResults = overrides.searchResults;
  }

  if (overrides.content) {
    merged.content = overrides.content;
  }

  if (overrides.unclaimed) {
    merged.unclaimed = overrides.unclaimed;
  }

  if (overrides.channels) {
    merged.channels = overrides.channels;
  }

  if (overrides.savedSearches) {
    merged.savedSearches = overrides.savedSearches;
  }

  if (overrides.adminUsers) {
    merged.adminUsers = overrides.adminUsers;
  }

  if (overrides.adminDetails) {
    merged.adminDetails = overrides.adminDetails;
  }

  if (overrides.exportHistory) {
    merged.exportHistory = overrides.exportHistory;
  }

  if (overrides.analytics) {
    merged.analytics = overrides.analytics;
  }

  merged.adminDetails = merged.adminDetails ?? defaultState.adminDetails;
  merged.adminUsers = merged.adminUsers ?? defaultState.adminUsers;

  return merged;
};

export const registerApiMocks = async (page: Page, state: MockState): Promise<void> => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      return route.continue();
    }

    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const respondJson = (data: any, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });

    const respondCsv = (filename: string) =>
      route.fulfill({
        status: 200,
        contentType: 'text/csv',
        headers: {
          'content-disposition': `attachment; filename="${filename}"`,
        },
        body: 'id,title\n1,example\n',
      });

    if (path === '/auth/register' && method === 'POST') {
      return respondJson({ userId: 'user-1', message: 'registered' }, 201);
    }

    if (path === '/auth/verify-email' && method === 'POST') {
      return respondJson({ message: 'verified', verified: true });
    }

    if (path === '/auth/resend-verification' && method === 'POST') {
      return respondJson({ message: 'resent' });
    }

    if (path === '/auth/login' && method === 'POST') {
      return respondJson({
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        user: {
          id: state.currentUser.id,
          email: state.currentUser.email,
          username: state.currentUser.username,
          profileSlug: state.currentUser.profileSlug,
          isAdmin: state.currentUser.isAdmin,
          isAwsEmployee: state.currentUser.isAwsEmployee,
        },
      });
    }

    if (path === '/users/me' && method === 'GET') {
      return respondJson(state.currentUser);
    }

    if (path === '/search' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? state.searchResults.limit);
      const offset = Number(url.searchParams.get('offset') ?? state.searchResults.offset);
      return respondJson({
        ...state.searchResults,
        limit,
        offset,
      });
    }

    if (path === '/search/saved' && method === 'GET') {
      return respondJson({ searches: state.savedSearches, count: state.savedSearches.length });
    }

    if (path === '/search/saved' && method === 'POST') {
      const payload = safePostDataJson(request);
      const entry = {
        id: `saved-${state.savedSearches.length + 1}`,
        userId: state.currentUser.id,
        name: payload.name ?? payload.query ?? 'Saved Search',
        query: payload.query ?? '',
        filters: payload.filters ?? {},
        isPublic: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.savedSearches.unshift(entry);
      return respondJson(entry);
    }

    if (path.startsWith('/search/saved/') && method === 'DELETE') {
      const id = path.split('/').pop();
      state.savedSearches = state.savedSearches.filter(entry => entry.id !== id);
      return respondJson({});
    }

    if (path.startsWith('/search/advanced') && method === 'GET') {
      const format = url.searchParams.get('format');
      if (format === 'csv') {
        return respondCsv('search-results.csv');
      }
      return respondJson({
        results: state.searchResults.items.map(item => ({
          id: item.id,
          userId: item.userId,
          title: item.title,
          description: item.description,
          contentType: item.contentType,
          visibility: item.visibility,
          publishDate: item.publishDate,
          captureDate: item.captureDate,
          metrics: item.metrics,
          tags: item.tags,
          url: item.urls?.[0]?.url,
          isClaimed: item.isClaimed,
          originalAuthor: item.originalAuthor,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          relevanceScore: 0.9,
          author: {
            id: state.currentUser.id,
            username: state.currentUser.username,
            email: state.currentUser.email,
            isAwsEmployee: state.currentUser.isAwsEmployee,
          },
        })),
        count: state.searchResults.total,
        query: url.searchParams.get('query') ?? '',
      });
    }

    if (path === '/content' && method === 'GET') {
      return respondJson({ content: state.content, total: state.content.length });
    }

    if (path === '/content' && method === 'POST') {
      const payload = safePostDataJson(request);
      const created = buildContent({
        id: `content-${state.content.length + 1}`,
        title: payload.title ?? 'Untitled',
        description: payload.description ?? '',
        contentType: payload.contentType ?? 'blog',
        visibility: payload.visibility ?? 'public',
        tags: payload.tags ?? [],
        urls: (payload.urls ?? []).map((value: string, index: number) => ({
          id: `url-${state.content.length + 1}-${index + 1}`,
          url: value,
        })),
        isClaimed: payload.isClaimed ?? true,
        userId: state.currentUser.id,
      });
      state.content.unshift(created);
      return respondJson(created, 201);
    }

    if (path === '/content/unclaimed' && method === 'GET') {
      return respondJson({ content: state.unclaimed, total: state.unclaimed.length });
    }

    if (path.startsWith('/content/') && path.endsWith('/claim') && method === 'POST') {
      const contentId = path.split('/')[2];
      const target = state.unclaimed.find(item => item.id === contentId);
      if (target) {
        target.isClaimed = true;
        state.unclaimed = state.unclaimed.filter(item => item.id !== contentId);
      }
      return respondJson({ success: true, content: target ?? null });
    }

    if (path === '/channels' && method === 'GET') {
      return respondJson({ channels: state.channels, total: state.channels.length });
    }

    if (path === '/channels' && method === 'POST') {
      const payload = safePostDataJson(request);
      const createdAt = nowIso();
      const channel = {
        id: `channel-${state.channels.length + 1}`,
        userId: state.currentUser.id,
        channelType: payload.channelType ?? 'blog',
        url: payload.url ?? 'https://example.com/rss.xml',
        name: payload.name ?? null,
        enabled: true,
        syncFrequency: payload.syncFrequency ?? 'daily',
        metadata: payload.metadata ?? {},
        createdAt,
        updatedAt: createdAt,
      };
      state.channels.push(channel);
      return respondJson(channel, 201);
    }

    if (path.startsWith('/channels/') && path.endsWith('/sync') && method === 'POST') {
      return respondJson({ message: 'sync started', syncJobId: `sync-${Date.now()}` });
    }

    if (path.startsWith('/channels/') && method === 'PUT') {
      const id = path.split('/')[2];
      const payload = safePostDataJson(request);
      const channel = state.channels.find(item => item.id === id);
      if (channel) {
        Object.assign(channel, payload, { updatedAt: nowIso() });
      }
      return respondJson(channel ?? {}, 200);
    }

    if (path.startsWith('/channels/') && method === 'DELETE') {
      const id = path.split('/')[2];
      state.channels = state.channels.filter(item => item.id !== id);
      return respondJson({});
    }

    if (path === '/analytics/user' && method === 'GET') {
      return respondJson(state.analytics);
    }

    if (path === '/analytics/export' && method === 'POST') {
      return respondCsv('analytics-export.csv');
    }

    if (path === '/analytics/track' && method === 'POST') {
      return respondJson({ success: true });
    }

    if (path === '/export/csv' && method === 'POST') {
      const payload = safePostDataJson(request);
      const filename = `${payload.programType ?? 'program'}-export.csv`;
      return respondCsv(filename);
    }

    if (path === '/export/history' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? state.exportHistory.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return respondJson({
        history: state.exportHistory.slice(offset, offset + limit),
        total: state.exportHistory.length,
        limit,
        offset,
      });
    }

    if (path === '/admin/users' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? state.adminUsers.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return respondJson({
        success: true,
        data: {
          users: state.adminUsers.slice(offset, offset + limit),
          total: state.adminUsers.length,
          limit,
          offset,
        },
      });
    }

    if (path.startsWith('/admin/users/') && method === 'GET') {
      const userId = path.split('/')[3];
      const detail = state.adminDetails[userId];
      return respondJson({ success: true, data: detail ?? state.adminDetails[Object.keys(state.adminDetails)[0]] });
    }

    if (path === '/admin/users/export' && method === 'POST') {
      return respondCsv('users.csv');
    }

    if (path === '/admin/badges/grant' && method === 'POST') {
      const payload = safePostDataJson(request);
      if (payload.userId && state.adminDetails[payload.userId]) {
        state.adminDetails[payload.userId].badges = [
          ...state.adminDetails[payload.userId].badges,
          { badgeType: payload.badgeType, awardedAt: nowIso() },
        ];
      }
      return respondJson({ success: true });
    }

    if (path === '/admin/badges/revoke' && method === 'DELETE') {
      return respondJson({ success: true });
    }

    if (path === '/admin/badges/bulk' && method === 'POST') {
      const payload = safePostDataJson(request);
      const total = Array.isArray(payload.userIds) ? payload.userIds.length : 0;
      return respondJson({
        success: true,
        data: {
          operation: payload.operation ?? 'grant',
          badgeType: payload.badgeType ?? 'community_builder',
          successful: total,
          failed: [],
          summary: { total, successful: total, failed: 0 },
        },
      });
    }

    if (path === '/admin/content/flagged' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return respondJson({
        success: true,
        data: {
          content: [],
          total: 0,
          limit,
          offset,
        },
      });
    }

    if (path.startsWith('/api/users/') && path.endsWith('/export') && method === 'GET') {
      return respondJson({
        user: state.currentUser,
        content: state.content,
        badges: state.adminDetails[state.currentUser.id]?.badges ?? [],
      });
    }

    if (path.startsWith('/api/users/') && method === 'DELETE') {
      return respondJson({ message: 'account deleted' });
    }

    if (path === '/user/consent' && method === 'POST') {
      return respondJson({ success: true });
    }

    if (path === '/user/consent' && method === 'GET') {
      return respondJson({ consentType: 'analytics', granted: true });
    }

    return route.continue();
  });
};
