import { ApiClient, createApiClient } from '@/api/client';
import { BadgeType, ContentType, Visibility } from '@shared/types';

const jsonResponse = (data: unknown, overrides: Partial<Response> = {}): Response => {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    } as Headers,
    json: async () => data,
    ...overrides,
  } as unknown as Response;
};

describe('ApiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('injects bearer token into authenticated requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ message: 'ok' }));
    global.fetch = fetchMock;

    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      getAuthToken: () => 'token-123',
    });

    await client.getStats();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/stats',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
  });

  it('omits authorization header when no token is available', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ message: 'ok' }));
    global.fetch = fetchMock;

    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      getAuthToken: () => null,
    });

    await client.getStats();

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit?.headers).not.toHaveProperty('Authorization');
  });

  it('serializes nested search filters and date ranges correctly', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [],
        total: 0,
        limit: 25,
        offset: 0,
      })
    );
    global.fetch = fetchMock;

    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      getAuthToken: () => 'token-abc',
    });

    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-02-01T00:00:00Z');

    await client.search({
      q: 'serverless',
      filters: {
        badges: [BadgeType.HERO, BadgeType.COMMUNITY_BUILDER],
        contentTypes: [ContentType.BLOG, ContentType.YOUTUBE],
        visibility: [Visibility.PUBLIC, Visibility.AWS_COMMUNITY],
        dateRange: { start, end },
        tags: ['lambda', 'eventbridge'],
      },
      limit: 25,
      offset: 0,
    });

    const [requestUrl] = fetchMock.mock.calls[0];
    const url = new URL(requestUrl);
    const params = url.searchParams;

    expect(url.pathname).toBe('/search');
    expect(params.get('q')).toBe('serverless');
    expect(params.get('badges')).toBe('hero,community_builder');
    expect(params.get('type')).toBe('blog,youtube');
    expect(params.get('visibility')).toBe('public,aws_community');
    expect(params.get('tags')).toBe('lambda,eventbridge');
    expect(params.get('startDate')).toBe('2024-01-01');
    expect(params.get('endDate')).toBe('2024-02-01');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('0');
  });

  it('propagates API errors using provided onError handler', async () => {
    const errorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { reason: 'Missing query' },
      },
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? 'application/json' : null,
      } as Headers,
      json: async () => errorResponse,
    } as unknown as Response);
    global.fetch = fetchMock;

    const onError = jest.fn();
    const client = new ApiClient({
      baseUrl: 'https://api.example.com',
      getAuthToken: () => 'token-xyz',
      onError,
    });

    await expect(
      client.search({
        q: 'aws',
        filters: {},
      })
    ).rejects.toThrow('Validation failed');

    expect(onError).toHaveBeenCalledWith(errorResponse.error);
  });

  it('fetches user profile and related resources via helper methods', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ user: { id: 'user-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ badges: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ content: [], total: 0 }),
      });
    global.fetch = fetchMock;

    const client = new ApiClient({ baseUrl: 'https://api.example.com' });

    await expect(client.getUserByUsername('testuser')).resolves.toEqual({ id: 'user-1' });
    await expect(client.getUserBadgesByUserId('user-1')).resolves.toEqual([]);
    await expect(
      client.getUserContent('user-1', { tags: ['serverless'], visibility: Visibility.PUBLIC })
    ).resolves.toEqual({ content: [], total: 0 });

    const firstCall = fetchMock.mock.calls[2][0] as string;
    expect(firstCall).toContain('tags=serverless');
    expect(firstCall).toContain('visibility=public');
  });

  it('resends verification email when requested', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'sent' }),
    });
    global.fetch = fetchMock;

    const client = new ApiClient({ baseUrl: 'https://api.example.com' });
    await client.resendVerification({ email: 'user@example.com' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/auth/resend-verification',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      })
    );
  });

  it('supports additional user management helpers', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'changed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ qrCode: 'qr', secret: 'secret' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'prefs' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ user: {}, content: [], badges: [] }),
      })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ message: 'deleted' }) });
    global.fetch = fetchMock;

    const client = new ApiClient({ baseUrl: 'https://api.example.com' });

    await client.changePassword('user-1', { currentPassword: 'old', newPassword: 'new' });
    await client.setupMfa('user-1');
    await client.updatePreferences('user-1', { receiveNewsletter: true });
    await client.exportUserData('user-1');
    await client.deleteAccount('user-1');

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://api.example.com/api/users/user-1/password',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://api.example.com/api/users/user-1/mfa/setup',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3,
      'https://api.example.com/api/users/user-1/preferences',
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4,
      'https://api.example.com/api/users/user-1/export',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(5,
      'https://api.example.com/api/users/user-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('serializes date range filters for search', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ results: [], total: 0, offset: 0, limit: 25 }),
    });
    global.fetch = fetchMock;

    const client = new ApiClient({ baseUrl: 'https://api.example.com' });
    await client.search({
      q: 'lambda',
      limit: 25,
      offset: 0,
      filters: {
        dateRange: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
      },
    } as any);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('startDate=2024-01-01');
    expect(url).toContain('endDate=2024-01-31');
  });

  it('covers channel and content helper routes', async () => {
    const client = new ApiClient({ baseUrl: 'https://api.example.com' });
    const responses = [
      { channels: [], total: 0 },
      { id: 'channel-1' },
      { id: 'channel-1', enabled: false },
      {},
      { message: 'queued', syncJobId: 'job-1' },
      { content: [], total: 0 },
      { success: true },
      { success: true },
      { content: [], total: 0 },
      { id: 'content-1' },
      { id: 'content-1' },
      { success: true },
      { updated: 2 },
      { id: 'content-1' },
      { duplicates: [], similarity: [] },
      { success: true, mergedContentId: 'id', mergeId: 'merge-1' },
      { success: true, restoredContentIds: [] },
      { merges: [], total: 0, hasMore: false },
    ];

    const requestSpy = jest.spyOn(client as any, 'request').mockImplementation(() => Promise.resolve(responses.shift()));

    await client.listChannels();
    await client.createChannel({ channelType: 'blog', url: 'https://example.com' } as any);
    await client.updateChannel('channel-1', { enabled: false });
    await client.deleteChannel('channel-1');
    await client.triggerChannelSync('channel-1');
    await client.getUnclaimedContent();
    await client.claimContent('content-1');
    await client.bulkClaimContent(['content-1']);
    await client.listContent();
    await client.createContent({ title: 'title', contentType: 'blog', urls: ['https://example.com'] } as any);
    await client.updateContent('content-1', { title: 'updated' });
    await client.deleteContent('content-1');
    await client.bulkUpdateVisibility(['content-1'], 'public');
    await client.getContent('content-1');
    await client.findDuplicates();
    await client.mergeContent({ contentIds: ['a', 'b'], primaryId: 'a' } as any);
    await client.unmergeContent('merge-1');
    await client.getMergeHistory();

    expect(requestSpy).toHaveBeenCalledTimes(18);
    requestSpy.mockRestore();
  });

  it('covers authentication helper routes', async () => {
    const client = new ApiClient({ baseUrl: 'https://api.example.com' });
    const requestSpy = jest.spyOn(client as any, 'request').mockImplementation(() => Promise.resolve({
      accessToken: 'access',
      idToken: 'id',
      refreshToken: 'refresh',
      message: 'ok',
    }));

    await client.register({ email: 'user@example.com', username: 'user', password: 'Password123!' } as any);
    await client.login({ email: 'user@example.com', password: 'Password123!' } as any);
    await client.refreshToken({ refreshToken: 'refresh' } as any);
    await client.verifyEmail({ email: 'user@example.com', confirmationCode: '123456' } as any);
    await client.forgotPassword({ email: 'user@example.com' });
    await client.resetPassword({ email: 'user@example.com', confirmationCode: '123456', newPassword: 'Password123!' });
    await client.resendVerification({ email: 'user@example.com' });

    expect(requestSpy).toHaveBeenCalledTimes(7);
    requestSpy.mockRestore();
  });
});
