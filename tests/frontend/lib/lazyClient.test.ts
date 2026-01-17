import type { ApiClientConfig } from '@/api/client';

const mockGetPublicApiClient = jest.fn();

jest.mock('@/api/client', () => ({
  getPublicApiClient: (...args: unknown[]) => mockGetPublicApiClient(...args),
}));

describe('lazyClient', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('delegates to getPublicApiClient when loading the public client', async () => {
    const client = { name: 'public-client' };
    const config: ApiClientConfig = { baseUrl: 'https://api.example.com' };
    mockGetPublicApiClient.mockReturnValue(client);

    const { loadPublicApiClient } = await import('@/lib/api/lazyClient');

    const resolved = await loadPublicApiClient(config);

    expect(mockGetPublicApiClient).toHaveBeenCalledWith(config);
    expect(resolved).toBe(client);
  });
});
