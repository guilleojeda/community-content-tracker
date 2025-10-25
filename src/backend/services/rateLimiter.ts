import { getCacheClient } from './cache/cache';

interface RateLimiterEntry {
  count: number;
  reset: number;
}

const localStore = new Map<string, RateLimiterEntry>();

function getLocalEntry(key: string, windowMs: number): RateLimiterEntry {
  const now = Date.now();
  const existing = localStore.get(key);

  if (!existing || existing.reset <= now) {
    const entry = { count: 0, reset: now + windowMs };
    localStore.set(key, entry);
    return entry;
  }

  return existing;
}

async function getCacheEntry(cacheKey: string, windowMs: number): Promise<RateLimiterEntry> {
  const client = await getCacheClient();
  const now = Date.now();
  const cached = await client.get<RateLimiterEntry>(cacheKey);

  if (!cached || cached.reset <= now) {
    return { count: 0, reset: now + windowMs };
  }

  return cached;
}

async function saveCacheEntry(cacheKey: string, entry: RateLimiterEntry): Promise<void> {
  const client = await getCacheClient();
  const ttlSeconds = Math.max(1, Math.ceil((entry.reset - Date.now()) / 1000));
  await client.set(cacheKey, entry, ttlSeconds);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  prefix: string = 'ratelimit'
): Promise<RateLimitResult> {
  try {
    const cacheKey = `${prefix}:${key}`;
    const useCache = Boolean(process.env.REDIS_URL || process.env.CACHE_URL);
    let entry: RateLimiterEntry;

    if (useCache) {
      entry = await getCacheEntry(cacheKey, windowMs);
    } else {
      entry = getLocalEntry(cacheKey, windowMs);
    }

    entry.count += 1;

    const allowed = entry.count <= limit;
    const remaining = allowed ? limit - entry.count : 0;

    if (useCache) {
      await saveCacheEntry(cacheKey, entry);
    } else {
      localStore.set(cacheKey, entry);
      if (localStore.size > 10000) {
        const now = Date.now();
        for (const [storeKey, storeEntry] of localStore.entries()) {
          if (storeEntry.reset <= now) {
            localStore.delete(storeKey);
          }
        }
      }
    }

    return {
      allowed,
      remaining,
      reset: entry.reset,
    };
  } catch (error) {
    console.warn('Rate limiter failed, allowing request:', error);
    return {
      allowed: true,
      remaining: limit,
      reset: Date.now() + windowMs,
    };
  }
}

export function clearRateLimiterStore(): void {
  localStore.clear();
}
