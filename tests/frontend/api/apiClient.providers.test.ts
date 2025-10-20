const mockJsonResponse = (data: unknown): Response => {
  return {
    ok: true,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    } as unknown as Headers,
    json: async () => data,
  } as unknown as Response;
};

describe('API client providers', () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    global.fetch = jest.fn().mockResolvedValue(mockJsonResponse({ success: true })) as any;

    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  afterEach(() => {
    if (originalWindow) {
      global.window = originalWindow;
    }
    global.fetch = originalFetch as any;
  });

  it('uses access token from localStorage when available', async () => {
    const { getAuthenticatedApiClient } = await import('@/api/client');

    window.localStorage.setItem('accessToken', 'persistent-token');

    const client = getAuthenticatedApiClient();
    await (client as any).listChannels();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/channels'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer persistent-token',
        }),
      })
    );
  });

  it('falls back to sessionStorage when localStorage is empty', async () => {
    const { getAuthenticatedApiClient } = await import('@/api/client');

    window.sessionStorage.setItem('accessToken', 'session-token');

    const client = getAuthenticatedApiClient();
    await (client as any).getStats();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer session-token',
        }),
      })
    );
  });

  it('returns null token when storage access throws', async () => {
    const { getAuthenticatedApiClient } = await import('@/api/client');

    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('storage blocked');
      },
    });

    const client = getAuthenticatedApiClient();
    await (client as any).getStats();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats'),
      expect.not.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer'),
        }),
      })
    );

    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: originalGetItem,
    });
  });

  it('returns null token when window is undefined', async () => {
    // Remove window before requiring module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window;
    const { getAuthenticatedApiClient } = await import('@/api/client');

    const client = getAuthenticatedApiClient();
    await (client as any).getStats();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats'),
      expect.not.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer'),
        }),
      })
    );
  });

  it('creates a new authenticated client when config overrides are provided', async () => {
    const { getAuthenticatedApiClient } = await import('@/api/client');

    const overrideClient = getAuthenticatedApiClient({
      baseUrl: 'https://override.example.com',
    });

    await (overrideClient as any).getStats();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://override.example.com/stats',
      expect.any(Object)
    );
  });

  it('returns cached singleton for authenticated client without overrides', async () => {
    const module = await import('@/api/client');
    const first = module.getAuthenticatedApiClient();
    const second = module.getAuthenticatedApiClient();

    expect(first).toBe(second);
  });

  it('creates public client overrides without affecting singleton', async () => {
    const module = await import('@/api/client');
    const override = module.getPublicApiClient({ baseUrl: 'https://public.example.com' });
    await (override as any).getStats();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://public.example.com/stats',
      expect.any(Object)
    );

    const shared = module.getPublicApiClient();
    const sharedAgain = module.getPublicApiClient();
    expect(shared).toBe(sharedAgain);
  });

  it('default error handler logs errors in non-production environments', async () => {
    const module = await import('@/api/client');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        error: { code: 'ERR_TEST', message: 'boom' },
      }),
    });

    const client = module.getAuthenticatedApiClient();
    await expect((client as any).getStats()).rejects.toThrow('boom');

    expect(consoleSpy).toHaveBeenCalledWith('API client error', { code: 'ERR_TEST', message: 'boom' });
    consoleSpy.mockRestore();
  });
});
