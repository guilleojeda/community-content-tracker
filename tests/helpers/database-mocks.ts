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
 */
export function mockDatabaseService() {
  const { pool, mockQuery } = createMockPool();

  jest.mock('../../src/backend/services/database', () => ({
    getDatabasePool: jest.fn().mockResolvedValue(pool),
    closeDatabasePool: jest.fn().mockResolvedValue(undefined),
  }));

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
export function setupChannelMocks(mockQuery: jest.Mock, options?: { duplicateUrl?: string }) {
  const existingUrls = new Set<string>(options?.duplicateUrl ? [options.duplicateUrl] : []);

  mockQuery.mockImplementation((sql: string, params: any[]) => {
    // Check for duplicate URL by user (SELECT * FROM channels WHERE user_id = $1 AND url = $2)
    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('user_id') && sql.includes('url')) {
      const userId = params[0];
      const url = params[1];

      if (url && existingUrls.has(url)) {
        // Return existing channel (duplicate found)
        return Promise.resolve(createMockQueryResult([{
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
        }]));
      }

      // No duplicate found
      return Promise.resolve(createMockQueryResult([]));
    }

    if (sql.includes('INSERT INTO channels')) {
      const url = params[2];
      if (url) {
        existingUrls.add(url);
      }

      return Promise.resolve(createMockQueryResult([{
        id: 'channel-123',
        user_id: params[0],
        channel_type: params[1],
        url: params[2],
        name: params[3],
        enabled: params[4] !== undefined ? params[4] : true,
        sync_frequency: params[5] || 'daily',
        metadata: typeof params[6] === 'string' ? JSON.parse(params[6]) : (params[6] || {}),
        last_sync_at: null,
        last_sync_status: null,
        last_sync_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      }]));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels') && sql.includes('WHERE id')) {
      const channelId = params.find((p: any) => typeof p === 'string' && p.startsWith('channel-'));

      // Return null for non-existent channel ID
      if (channelId === '00000000-0000-0000-0000-000000000000') {
        return Promise.resolve(createMockQueryResult([]));
      }

      // Return channel with different user ID if specified
      const userId = params.find((p: any) => typeof p === 'string' && p.startsWith('user-'));

      return Promise.resolve(createMockQueryResult([{
        id: channelId || 'channel-123',
        user_id: userId || 'user-123',
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
      }]));
    }

    if (sql.includes('SELECT') && sql.includes('FROM channels')) {
      return Promise.resolve(createMockQueryResult([{
        id: 'channel-123',
        user_id: 'user-123',
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
      }]));
    }

    if (sql.includes('UPDATE channels')) {
      return Promise.resolve(createMockQueryResult([{
        id: 'channel-123',
        user_id: 'user-123',
        channel_type: 'blog',
        url: 'https://example.com/feed',
        name: params[0] || 'Test Channel',
        enabled: params.find((p: any) => typeof p === 'boolean') !== undefined ? params.find((p: any) => typeof p === 'boolean') : true,
        sync_frequency: 'daily',
        metadata: {},
      }]));
    }

    if (sql.includes('DELETE FROM channels')) {
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
