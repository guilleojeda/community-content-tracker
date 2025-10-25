import Redis from 'ioredis';

export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

let redisClient: Redis | null = null;
let cacheClient: CacheClient | null = null;

function createNoopCache(): CacheClient {
  return {
    async get() {
      return null;
    },
    async set() {
      // no-op
    },
  };
}

async function createRedisCache(): Promise<CacheClient> {
  const url = process.env.REDIS_URL || process.env.CACHE_URL;
  if (!url) {
    return createNoopCache();
  }

  if (!redisClient) {
    redisClient = new Redis(url, {
      enableAutoPipelining: true,
      maxRetriesPerRequest: 1,
    });

    redisClient.on('error', (error) => {
      console.error('Redis cache error:', error);
    });
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const value = await redisClient!.get(key);
        return value ? (JSON.parse(value) as T) : null;
      } catch (error) {
        console.warn('Cache get failed, ignoring cache miss:', error);
        return null;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      try {
        await redisClient!.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (error) {
        console.warn('Cache set failed:', error);
      }
    },
  };
}

export async function getCacheClient(): Promise<CacheClient> {
  if (cacheClient) {
    return cacheClient;
  }

  cacheClient = await createRedisCache();
  return cacheClient;
}

export async function resetCacheClient(): Promise<void> {
  cacheClient = null;
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
