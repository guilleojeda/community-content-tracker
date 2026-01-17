import { getCacheClient, resetCacheClient } from '../../../src/backend/services/cache/cache';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const RedisMock = (jest.requireMock('ioredis') as { default: jest.Mock }).default;

describe('cache client', () => {
  const originalEnv = { ...process.env };
  let redisInstance: {
    get: jest.Mock;
    set: jest.Mock;
    on: jest.Mock;
    quit: jest.Mock;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    RedisMock.mockReset();
    redisInstance = {
      get: jest.fn(),
      set: jest.fn(),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    RedisMock.mockImplementation(() => redisInstance);
  });

  afterEach(async () => {
    await resetCacheClient();
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('returns a noop cache when no redis url configured', async () => {
    delete process.env.REDIS_URL;
    delete process.env.CACHE_URL;

    const client = await getCacheClient();
    const cached = await getCacheClient();
    expect(cached).toBe(client);

    expect(await client.get('key')).toBeNull();
    await expect(client.set('key', { ok: true }, 60)).resolves.toBeUndefined();
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it('uses redis cache and tolerates cache failures', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    redisInstance.get
      .mockResolvedValueOnce(JSON.stringify({ ok: true }))
      .mockRejectedValueOnce(new Error('boom'));
    redisInstance.set.mockRejectedValueOnce(new Error('write failed'));

    const client = await getCacheClient();

    expect(redisInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    const errorHandler = redisInstance.on.mock.calls.find((call) => call[0] === 'error')?.[1];
    if (errorHandler) {
      errorHandler(new Error('redis'));
    }

    const hit = await client.get('key');
    expect(hit).toEqual({ ok: true });

    const miss = await client.get('key');
    expect(miss).toBeNull();

    await expect(client.set('key', { ok: true }, 30)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Redis cache error:', expect.any(Error));
  });

  it('closes the redis connection on reset', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    await getCacheClient();
    await resetCacheClient();

    expect(redisInstance.quit).toHaveBeenCalled();
  });
});
