import { consumeRateLimit, clearRateLimiterStore } from '../../../src/backend/services/rateLimiter';
import * as cacheModule from '../../../src/backend/services/cache/cache';

describe('RateLimiter service', () => {
  let store: Map<string, { value: any; ttl: number }>;
  let mockGet: jest.Mock;
  let mockSet: jest.Mock;
  let getCacheClientSpy: jest.SpyInstance;

  beforeEach(() => {
    store = new Map();
    mockGet = jest.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? entry.value : null;
    });
    mockSet = jest.fn(async (key: string, value: any, ttl: number) => {
      store.set(key, { value, ttl });
    });

    getCacheClientSpy = jest
      .spyOn(cacheModule, 'getCacheClient')
      .mockResolvedValue({
        get: mockGet,
        set: mockSet,
      });

    delete process.env.REDIS_URL;
    delete process.env.CACHE_URL;
  });

  afterEach(async () => {
    getCacheClientSpy.mockRestore();
    store.clear();
    mockGet.mockReset();
    mockSet.mockReset();
    clearRateLimiterStore();
    await cacheModule.resetCacheClient();
  });

  it('allows requests within the limit for local store', async () => {
    const first = await consumeRateLimit('127.0.0.1', 2, 1000, 'test');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);

    const second = await consumeRateLimit('127.0.0.1', 2, 1000, 'test');
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const third = await consumeRateLimit('127.0.0.1', 2, 1000, 'test');
    expect(third.allowed).toBe(false);
  });

  it('enforces limit and persists counters when Redis cache configured', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const first = await consumeRateLimit('10.0.0.1', 2, 60_000, 'redis');
    const second = await consumeRateLimit('10.0.0.1', 2, 60_000, 'redis');
    const third = await consumeRateLimit('10.0.0.1', 2, 60_000, 'redis');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);

    expect(mockSet).toHaveBeenCalled();
    const ttl = mockSet.mock.calls[0][2];
    expect(ttl).toBeGreaterThanOrEqual(59);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('resets cached counters when window expires', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const key = '192.168.0.5';
    const prefix = 'redis';

    await consumeRateLimit(key, 1, 60_000, prefix);

    const cacheKey = `${prefix}:${key}`;
    const cached = store.get(cacheKey);
    if (!cached) {
      throw new Error('Expected cached entry to exist');
    }
    cached.value.reset = Date.now() - 1;
    store.set(cacheKey, cached);

    const result = await consumeRateLimit(key, 1, 60_000, prefix);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });
});
