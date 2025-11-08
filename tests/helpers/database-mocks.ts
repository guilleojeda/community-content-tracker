/**
 * Database mocking utilities for unit tests
 *
 * Provides reusable mock implementations for database operations
 * to avoid requiring a real database connection in unit tests.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Mock query result builder
 */
export function createMockQueryResult<T extends QueryResultRow = any>(rows: T[] = [], rowCount?: number): QueryResult<T> {
  return {
    rows,
    rowCount: rowCount ?? rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

/**
 * Create a mock database pool with spy functions
 */
export function createMockPool() {
  const mockQuery = jest.fn();
  const mockConnect = jest.fn();
  const mockEnd = jest.fn();

  const pool = {
    query: mockQuery,
    connect: mockConnect,
    end: mockEnd,
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    on: jest.fn(),
    removeListener: jest.fn(),
  } as unknown as Pool;

  return {
    pool,
    mockQuery,
    mockConnect,
    mockEnd,
  };
}

/**
 * Create a mock pool client
 */
export function createMockPoolClient() {
  const mockQuery = jest.fn();
  const mockRelease = jest.fn();

  const client = {
    query: mockQuery,
    release: mockRelease,
    on: jest.fn(),
    removeListener: jest.fn(),
  } as unknown as PoolClient;

  return {
    client,
    mockQuery,
    mockRelease,
  };
}

/**
 * Mock database service (for getDatabasePool)
 * Uses the new setTestDatabasePool injection method
 */
export function mockDatabaseService() {
  const { pool, mockQuery } = createMockPool();

  // Mock the database service module
  jest.mock('../../src/backend/services/database', () => ({
    getDatabasePool: jest.fn().mockResolvedValue(pool),
    closeDatabasePool: jest.fn().mockResolvedValue(undefined),
    setTestDatabasePool: jest.fn(),
    resetDatabaseCache: jest.fn(),
  }));

  return { pool, mockQuery };
}

/**
 * Setup database pool injection for tests
 * This is the preferred method for new tests
 */
export function setupDatabasePoolInjection() {
  const { pool, mockQuery } = createMockPool();

  // Import and use setTestDatabasePool from the actual module
  // This must be called BEFORE the handler/repository is imported
  const databaseService = require('../../src/backend/services/database');
  if (databaseService.setTestDatabasePool) {
    databaseService.setTestDatabasePool(pool);
  }

  return { pool, mockQuery };
}

/**
 * Setup mock for user operations
 */
export function setupUserMocks(mockQuery: jest.Mock) {
  // Mock user creation
  mockQuery.mockImplementation((sql: string, params: any[]) => {
    if (sql.includes('INSERT INTO users')) {
      return Promise.resolve(createMockQueryResult([{
        id: 'user-123',
        cognito_sub: params[0],
        email: params[1],
        username: params[2],
        profile_slug: params[3],
        default_visibility: params[4] || 'private',
      }]));
    }

    // Mock user lookup
    if (sql.includes('SELECT') && sql.includes('FROM users')) {
      return Promise.resolve(createMockQueryResult([{
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        profile_slug: 'test-user',
        default_visibility: 'private',
      }]));
    }

    // Mock user deletion
    if (sql.includes('DELETE FROM users')) {
      return Promise.resolve(createMockQueryResult([], 1));
    }

    return Promise.resolve(createMockQueryResult([]));
  });
}

/**
 * Setup mock for channel operations
 */
export function setupChannelMocks(mockQuery: jest.Mock, options?: { duplicateUrl?: string; defaultUserId?: string }) {
  const existingUrls = new Set<string>(options?.duplicateUrl ? [options.duplicateUrl] : []);
  const channels = new Map<string, any>();
  let channelCounter = 1;

  // Pre-populate with a test channel for the default user
  if (options?.defaultUserId) {
    const defaultChannel = {
      id: 'channel-123',
      user_id: options.defaultUserId,
      channel_type: 'blog',
      url: 'https://example.com/feed',
      name: 'Test Channel',
      enabled: true,
      sync_frequency: 'daily',
      metadata: {},
      last_sync_at: null,
      last_sync_status: null,
      last_sync_error: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    channels.set('channel-123', defaultChannel);
  }

  mockQuery.mockImplementation((sql: string, params: any[]) => {
    // Check for duplicate URL by user (SELECT * FROM channels WHERE user_id = $1 AND url = $2)
    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('user_id') && sql.includes('url')) {
      const userId = params[0];
      const url = params[1];

      // Check if channel exists in our map
      for (const [id, channel] of channels.entries()) {
        if (channel.user_id === userId && channel.url === url) {
          return Promise.resolve(createMockQueryResult([channel]));
        }
      }

      if (url && existingUrls.has(url)) {
        // Return existing channel (duplicate found)
        const existingChannel = {
          id: 'existing-channel',
          user_id: userId,
          channel_type: 'blog',
          url: url,
          name: 'Existing Channel',
          enabled: true,
          sync_frequency: 'daily',
          metadata: {},
          last_sync_at: null,
          last_sync_status: null,
          last_sync_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        channels.set('existing-channel', existingChannel);
        return Promise.resolve(createMockQueryResult([existingChannel]));
      }

      // No duplicate found
      return Promise.resolve(createMockQueryResult([]));
    }

    if (sql.includes('INSERT INTO channels')) {
      const url = params[2];
      if (url) {
        existingUrls.add(url);
      }

      const channelId = `channel-${channelCounter++}`;
      const newChannel = {
        id: channelId,
        user_id: params[0],
        channel_type: params[1],
        url: params[2],
        name: params[3] || null,
        enabled: params[4] !== undefined ? params[4] : true,
        sync_frequency: params[5] || 'daily',
        metadata: typeof params[6] === 'string' ? JSON.parse(params[6]) : (params[6] || {}),
        last_sync_at: null,
        last_sync_status: null,
        last_sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      channels.set(channelId, newChannel);
      return Promise.resolve(createMockQueryResult([newChannel]));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('WHERE id')) {
      const channelId = params[0];

      // Return null for non-existent channel ID
      if (channelId === '00000000-0000-0000-0000-000000000000' || !channels.has(channelId)) {
        return Promise.resolve(createMockQueryResult([]));
      }

      const channel = channels.get(channelId);
      return Promise.resolve(createMockQueryResult([channel]));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('enabled') && sql.includes('channel_type')) {
      // findActiveByType
      const channelType = params[0];
      const activeChannels = Array.from(channels.values()).filter(
        (c: any) => c.channel_type === channelType && c.enabled === true
      );
      return Promise.resolve(createMockQueryResult(activeChannels));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('sync_frequency') && sql.includes('ORDER BY last_sync_at')) {
      const syncFrequency = params[0];
      const activeChannels = Array.from(channels.values()).filter(
        (c: any) => c.enabled === true && c.sync_frequency === syncFrequency
      );

      activeChannels.sort((a: any, b: any) => {
        const aTime = a.last_sync_at ? a.last_sync_at.getTime() : -Infinity;
        const bTime = b.last_sync_at ? b.last_sync_at.getTime() : -Infinity;

        return aTime - bTime;
      });

      return Promise.resolve(createMockQueryResult(activeChannels));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels') && params.length === 1 && typeof params[0] === 'string') {
      // findByUserId
      const userId = params[0];
      if (userId === '00000000-0000-0000-0000-000000000000') {
        return Promise.resolve(createMockQueryResult([]));
      }
      const userChannels = Array.from(channels.values()).filter((c: any) => c.user_id === userId);
      return Promise.resolve(createMockQueryResult(userChannels));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels')) {
      const allChannels = Array.from(channels.values());
      return Promise.resolve(createMockQueryResult(allChannels));
    }

    if (sql.includes('UPDATE channels')) {
      // Find channel ID from WHERE clause (usually last param)
      const channelId = params[params.length - 1];

      if (channelId === '00000000-0000-0000-0000-000000000000' || !channels.has(channelId)) {
        return Promise.resolve(createMockQueryResult([]));
      }

      const channel = channels.get(channelId);

      // Update channel fields based on SQL query and params
      if (sql.includes('last_sync_status')) {
        channel.last_sync_status = params[0];
        channel.last_sync_at = new Date();
        if (params[1]) {
          channel.last_sync_error = params[1];
        } else {
          channel.last_sync_error = null;
        }
      } else {
        // Regular update - match params to fields
        if (sql.includes('name')) channel.name = params[0];
        if (sql.includes('enabled')) {
          const enabledParam = params.find((p: any) => typeof p === 'boolean');
          if (enabledParam !== undefined) channel.enabled = enabledParam;
        }
        if (sql.includes('sync_frequency')) {
          const freqParam = params.find((p: any) => ['daily', 'weekly', 'manual'].includes(p));
          if (freqParam) channel.sync_frequency = freqParam;
        }
        if (sql.includes('metadata')) {
          const metadataParam = params.find((p: any) => typeof p === 'object' && !Array.isArray(p));
          if (metadataParam) channel.metadata = metadataParam;
        }
      }

      channel.updated_at = new Date();
      channels.set(channelId, channel);
      return Promise.resolve(createMockQueryResult([channel]));
    }

    if (sql.includes('DELETE FROM channels')) {
      const channelId = params[0];
      if (channelId === '00000000-0000-0000-0000-000000000000' || !channels.has(channelId)) {
        return Promise.resolve(createMockQueryResult([], 0));
      }
      channels.delete(channelId);
      return Promise.resolve(createMockQueryResult([], 1));
    }

    return Promise.resolve(createMockQueryResult([]));
  });
}

/**
 * Setup mock for content operations
 */
export function setupContentMocks(mockQuery: jest.Mock) {
  mockQuery.mockImplementation((sql: string, params: any[]) => {
    if (sql.includes('INSERT INTO content')) {
      return Promise.resolve(createMockQueryResult([{
        id: 'content-123',
        user_id: params[0],
        title: params[1],
        description: params[2],
        content_type: params[3],
        visibility: params[4] || 'private',
        publish_date: params[5],
        capture_date: new Date(),
        metrics: {},
        tags: params[6] || [],
        embedding: params[7],
        created_at: new Date(),
        updated_at: new Date(),
      }]));
    }

    if (sql.includes('SELECT') && sql.includes('FROM content')) {
      if (sql.includes('WHERE url')) {
        // Duplicate check - return null for no duplicate
        return Promise.resolve(createMockQueryResult([]));
      }

      return Promise.resolve(createMockQueryResult([{
        id: 'content-123',
        user_id: 'user-123',
        title: 'Test Content',
        description: 'Test description',
        content_type: 'blog',
        visibility: 'private',
        publish_date: new Date(),
        capture_date: new Date(),
        metrics: {},
        tags: [],
        embedding: null,
      }]));
    }

    return Promise.resolve(createMockQueryResult([]));
  });
}

/**
 * Complete mock setup for all database operations
 */
export function setupAllDatabaseMocks() {
  const { pool, mockQuery } = createMockPool();

  // Default implementation that handles all common queries
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    // User queries
    if (sql.includes('users')) {
      if (sql.includes('INSERT')) {
        return createMockQueryResult([{
          id: 'user-123',
          email: params[1] || 'test@example.com',
          username: params[2] || 'testuser',
        }]);
      }
      if (sql.includes('SELECT')) {
        return createMockQueryResult([{
          id: 'user-123',
          email: 'test@example.com',
          username: 'testuser',
          default_visibility: 'private',
        }]);
      }
    }

    // Channel queries
    if (sql.includes('channels')) {
      if (sql.includes('INSERT')) {
        return createMockQueryResult([{ id: 'channel-123' }]);
      }
      if (sql.includes('SELECT')) {
        return createMockQueryResult([{
          id: 'channel-123',
          user_id: 'user-123',
          channel_type: 'blog',
          url: 'https://example.com',
          enabled: true,
        }]);
      }
      if (sql.includes('UPDATE')) {
        return createMockQueryResult([{ id: 'channel-123' }]);
      }
    }

    // Content queries
    if (sql.includes('content')) {
      if (sql.includes('INSERT')) {
        return createMockQueryResult([{ id: 'content-123' }]);
      }
      if (sql.includes('SELECT')) {
        return createMockQueryResult([{
          id: 'content-123',
          title: 'Test Content',
        }]);
      }
    }

    // Default empty result
    return createMockQueryResult([]);
  });

  return { pool, mockQuery };
}
