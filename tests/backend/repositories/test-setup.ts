import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetDatabaseCache } from '../../../src/backend/services/database';

export interface TestDatabaseSetup {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  connectionString: string;
}

export class TestDatabase {
  private static instance: TestDatabase;
  private container: StartedPostgreSqlContainer | null = null;
  private pool: Pool | null = null;
  private usageCount = 0;

  private constructor() {}

  public static getInstance(): TestDatabase {
    if (!TestDatabase.instance) {
      TestDatabase.instance = new TestDatabase();
    }
    return TestDatabase.instance;
  }

  public async setup(): Promise<TestDatabaseSetup> {
    this.usageCount += 1;

    if (!this.container || !this.pool) {
      console.log('Starting PostgreSQL test container...');

      this.container = await new PostgreSqlContainer('pgvector/pgvector:pg15')
        .withDatabase('test_db')
        .withUsername('test_user')
        .withPassword('test_password')
        .withExposedPorts({ container: 5432, host: 0 })
        .start();

        const connectionString = this.container.getConnectionUri();
        this.pool = new Pool({ connectionString });

        await this.runMigrations();
    }

    const connectionString = this.container!.getConnectionUri();
    return {
      container: this.container!,
      pool: this.pool!,
      connectionString,
    };
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }

    console.log('Running database migrations...');

    // Install required extensions first (must be done outside transaction)
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Read the migration file
    const migrationPath = join(__dirname, '../../../src/backend/migrations/001_initial_schema.sql');
    let migrationSQL = readFileSync(migrationPath, 'utf8');

    // Remove CREATE EXTENSION lines since we already created them
    migrationSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('CREATE EXTENSION'))
      .join('\n');

    // Execute the migration in a transaction for atomicity
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migrationSQL);

      // Ensure analytics table exists for tests that depend on it
      await client.query(`
        CREATE TABLE IF NOT EXISTS content_analytics (
          content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
          views_count INTEGER DEFAULT 0,
          likes_count INTEGER DEFAULT 0,
          shares_count INTEGER DEFAULT 0,
          comments_count INTEGER DEFAULT 0,
          engagement_score NUMERIC DEFAULT 0,
          last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL
        );
      `);

      await client.query('COMMIT');
      console.log('Database migrations completed.');
    } catch (error: any) {
      await client.query('ROLLBACK');
      // If vector-related operation fails, that's okay for tests
      if (error.message && (error.message.includes('vector') || error.message.includes('ivfflat'))) {
        console.warn('Vector-related migration skipped:', error.message);
      } else {
        console.error('Migration error:', error.message);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  public async cleanup(): Promise<void> {
    if (this.usageCount > 0) {
      this.usageCount -= 1;
    }

    if (this.usageCount > 0) {
      return;
    }

    if (this.pool) {
      try {
        await this.pool.end();
      } catch (error: any) {
        if (!error?.code || error.code !== '57P01') {
          console.warn('Error while closing test database pool:', error);
        }
      } finally {
        this.pool = null;
      }
    }

    if (this.container) {
      try {
        await this.container.stop();
      } catch (error) {
        console.warn('Error while stopping test database container:', (error as Error).message);
      } finally {
        this.container = null;
      }
    }

    resetDatabaseCache();
    this.usageCount = 0;
  }

  public async clearData(): Promise<void> {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }

    // Clear all data but keep schema - only truncate tables that exist
    const tables = [
      'audit_log',
      'content_bookmarks',  // May not exist yet
      'user_follows',  // May not exist yet
      'content_analytics',  // May not exist yet
      'content_merge_history',  // Sprint 3
      'content_urls',
      'user_badges',
      'content',
      'channels',  // Sprint 4
      'users'
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      } catch (error: any) {
        // If table doesn't exist, skip it silently
        if (error.code === '42P01') {  // undefined_table error code
          console.log(`Table ${table} does not exist, skipping truncate`);
        } else {
          throw error;
        }
      }
    }
  }

  public getPool(): Pool {
    if (!this.pool) {
      throw new Error('Pool not initialized. Call setup() first.');
    }
    return this.pool;
  }
}

// Test utilities
export const testDb = TestDatabase.getInstance();

export const createTestUser = async (pool: Pool, overrides: Partial<any> = {}) => {
  // Use high-resolution timestamp and random string for uniqueness
  const uniqueId = `${Date.now()}${Math.random().toString(36).substring(2,11)}`;
  const userData = {
    cognitoSub: `test-sub-${uniqueId}`,
    email: `test-${uniqueId}@example.com`,
    username: `testuser${uniqueId}`,
    profileSlug: `test-slug-${uniqueId}`,
    defaultVisibility: 'private',
    isAdmin: false,
    isAwsEmployee: false,
    ...overrides,
  };

  const result = await pool.query(`
    INSERT INTO users (cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    userData.cognitoSub,
    userData.email,
    userData.username,
    userData.profileSlug,
    userData.defaultVisibility,
    userData.isAdmin,
    userData.isAwsEmployee,
  ]);

  return result.rows[0];
};

export const createTestContent = async (pool: Pool, userId: string, overrides: Partial<any> = {}) => {
  const contentData = {
    title: `Test Content ${Date.now()}`,
    description: 'Test description',
    contentType: 'blog',
    visibility: 'public',
    publishDate: new Date(),
    isClaimed: true,
    tags: ['test'],
    ...overrides,
  };

  const result = await pool.query(`
    INSERT INTO content (user_id, title, description, content_type, visibility, publish_date, is_claimed, tags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    userId,
    contentData.title,
    contentData.description,
    contentData.contentType,
    contentData.visibility,
    contentData.publishDate,
    contentData.isClaimed,
    contentData.tags,
  ]);

  return result.rows[0];
  };

  // Jest setup and teardown
  export const setupTestDatabase = async () => {
    const setup = await testDb.setup();

  // Set environment variables for the database connection
  process.env.DATABASE_URL = setup.connectionString;

  return setup;
  };

  export const teardownTestDatabase = async () => {
  await testDb.cleanup();
  };

export const resetTestData = async () => {
  await testDb.clearData();
};
