import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { resetDatabaseCache, setTestDatabasePool } from '../../../src/backend/services/database';

jest.setTimeout(120000);

const INITIAL_SCHEMA_MIGRATION = '20240101000000000_initial_schema.sql';
const isTestDbDebugEnabled = process.env.DEBUG_TEST_DB === '1';
const testDbLog = (...args: Parameters<typeof console.log>) => {
  if (isTestDbDebugEnabled) {
    console.log(...args);
  }
};
const testDbWarn = (...args: Parameters<typeof console.warn>) => {
  if (isTestDbDebugEnabled) {
    console.warn(...args);
  }
};
const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
const TEST_DB_USER = process.env.TEST_DB_USER ?? 'test_user';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? 'test_password';

export interface TestDatabaseSetup {
  container: StartedPostgreSqlContainer | null;
  pool: Pool;
  connectionString: string;
}

export class TestDatabase {
  private static instance: TestDatabase;
  private container: StartedPostgreSqlContainer | null = null;
  private pool: Pool | null = null;
  private pgMemDb: IMemoryDb | null = null;
  private localConnectionString: string | null = null;
  private initPromise: Promise<void> | null = null;
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
      if (!this.initPromise) {
        this.initPromise = (async () => {
          const localConnection = process.env.LOCAL_PG_URL;
          const forceInMemory = process.env.TEST_DB_INMEMORY === 'true';

          if (localConnection) {
            testDbLog('Using local PostgreSQL instance for tests.');
            this.container = null;
            this.pgMemDb = null;
            this.pool = new Pool({ connectionString: localConnection });
            process.env.TEST_DB_INMEMORY = 'false';
            this.localConnectionString = localConnection;
          } else if (forceInMemory || !this.isDockerAvailable()) {
            if (forceInMemory) {
              testDbLog('Forcing in-memory PostgreSQL for tests.');
            } else {
              testDbWarn('Docker not available, using in-memory PostgreSQL for tests.');
            }
            this.setupInMemoryDatabase();
          } else {
            testDbLog('Starting PostgreSQL test container...');

            try {
              this.container = await new PostgreSqlContainer('pgvector/pgvector:pg15')
                .withDatabase('test_db')
                .withUsername(TEST_DB_USER)
                .withPassword(TEST_DB_PASSWORD)
                .withExposedPorts({ container: 5432, host: 0 })
                .start();

              try {
                await this.container.exec([
                  'psql',
                  '-U',
                  'postgres',
                  '-c',
                  `ALTER ROLE ${TEST_DB_USER} WITH SUPERUSER;`,
                ]);
              } catch (grantError) {
                testDbWarn('Unable to grant superuser to test role automatically:', grantError);
              }

              const connectionString = this.container.getConnectionUri();
              this.pool = new Pool({ connectionString });
              process.env.TEST_DB_INMEMORY = 'false';
              this.localConnectionString = null;
            } catch (error) {
              testDbWarn('Testcontainers unavailable, falling back to in-memory PostgreSQL for tests.');
              this.setupInMemoryDatabase();
            }
          }

          if (!this.pool) {
            throw new Error('Failed to initialize test database pool');
          }

          await this.runMigrations();
        })().finally(() => {
          this.initPromise = null;
        });
      }

      await this.initPromise;
    }

    const connectionString = this.localConnectionString
      ? this.localConnectionString
      : this.container
        ? this.container.getConnectionUri()
        : 'postgresql://pg-mem.local/test';
    return {
      container: this.container,
      pool: this.pool!,
      connectionString,
    };
  }

  private isDockerAvailable(): boolean {
    const result = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 2000 });
    if (result.error) {
      return false;
    }
    return result.status === 0;
  }

  private setupInMemoryDatabase(): void {
    this.container = null;
    this.pgMemDb = newDb({ autoCreateForeignKeyIndices: true });
    process.env.TEST_DB_INMEMORY = 'true';
    this.localConnectionString = null;

    this.pgMemDb.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });

    this.pgMemDb.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });

    this.pgMemDb.public.registerFunction({
      name: 'now',
      returns: DataType.timestamptz,
      implementation: () => new Date(),
      impure: true,
    });

    this.pgMemDb.public.registerFunction({
      name: 'clock_timestamp',
      returns: DataType.timestamptz,
      implementation: () => new Date(),
      impure: true,
    });

    this.pgMemDb.public.registerFunction({
      name: 'similarity',
      args: [DataType.text, DataType.text],
      returns: DataType.numeric,
      implementation: (a: string, b: string) => {
        if (!a || !b) {
          return 0;
        }
        const makeTrigrams = (input: string): Set<string> => {
          const normalized = `  ${input.toLowerCase()} `;
          const trigrams = new Set<string>();
          for (let i = 0; i < normalized.length - 2; i += 1) {
            trigrams.add(normalized.substring(i, i + 3));
          }
          return trigrams;
        };

        const trigramsA = makeTrigrams(a);
        const trigramsB = makeTrigrams(b);

        if (trigramsA.size === 0 || trigramsB.size === 0) {
          return 0;
        }

        let intersection = 0;
        trigramsA.forEach(trigram => {
          if (trigramsB.has(trigram)) {
            intersection += 1;
          }
        });

        const union = trigramsA.size + trigramsB.size - intersection;
        if (union === 0) {
          return 0;
        }

        return intersection / union;
      },
    });

    this.pgMemDb.public.registerFunction({
      name: 'jsonb_build_object',
      args: [DataType.text, DataType.integer],
      returns: DataType.jsonb,
      implementation: (key: string, value: number) => ({ [key]: value }),
    });

    this.pgMemDb.public.registerFunction({
      name: 'round',
      args: [DataType.float, DataType.float],
      returns: DataType.float,
      implementation: (value: number, precision: number) => {
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
      },
    });

    const pg = this.pgMemDb.adapters.createPg();
    this.pool = new pg.Pool();

    const originalQuery = this.pool.query.bind(this.pool);
    (this.pool as any).query = (...args: any[]) => {
      const text: string | undefined = typeof args[0] === 'string'
        ? args[0]
        : args[0]?.text;

      if (text && text.trim().toUpperCase().startsWith('CREATE EXTENSION')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      return originalQuery(...args);
    };
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }

    testDbLog('Running database migrations...');

    const useSimplifiedSchema = this.pgMemDb !== null || this.localConnectionString !== null;
    const connectionString = this.container
      ? this.container.getConnectionUri()
      : this.localConnectionString ?? 'postgresql://pg-mem.local/test';

    if (!useSimplifiedSchema) {
      const backendDir = join(__dirname, '../../../src/backend');
      const verboseMigrations = process.env.DEBUG_TEST_MIGRATIONS === '1';

      const result = spawnSync(
        'npx',
        [
          'node-pg-migrate',
          'up',
          '--database-url-var',
          'DATABASE_URL',
          '--migrations-dir',
          'migrations',
        ],
        {
          cwd: backendDir,
          stdio: verboseMigrations ? 'inherit' : ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            DATABASE_URL: connectionString,
          },
        }
      );

      if (result.status !== 0) {
        if (!verboseMigrations) {
          const stdout = result.stdout?.toString().trim();
          const stderr = result.stderr?.toString().trim();
          if (stdout) {
            console.error(stdout);
          }
          if (stderr) {
            console.error(stderr);
          }
        }
        throw new Error('Failed to execute database migrations for tests');
      }

      if (!verboseMigrations) {
        testDbLog('Database migrations applied.');
      }
      return;
    }

    let migrationSQL: string | null = null;

    // Read the migration file
    if (!useSimplifiedSchema) {
      const migrationPath = join(__dirname, '../../../src/backend/migrations', INITIAL_SCHEMA_MIGRATION);
      migrationSQL = readFileSync(migrationPath, 'utf8');

      migrationSQL = migrationSQL
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('CREATE EXTENSION') && !line.startsWith('--'))
        .join('\n');
    }

    // Execute the migration in a transaction for atomicity
    const client = await this.pool.connect();
    let beganTransaction = false;
    try {
      if (!useSimplifiedSchema) {
        await client.query('BEGIN');
        beganTransaction = true;
      }

      if (useSimplifiedSchema) {
        const dropStatements = [
          'DROP TABLE IF EXISTS content_merge_history CASCADE',
          'DROP TABLE IF EXISTS user_consent CASCADE',
          'DROP TABLE IF EXISTS duplicate_pairs CASCADE',
          'DROP TABLE IF EXISTS saved_searches CASCADE',
          'DROP TABLE IF EXISTS admin_actions CASCADE',
          'DROP TABLE IF EXISTS analytics_events CASCADE',
          'DROP TABLE IF EXISTS channels CASCADE',
          'DROP TABLE IF EXISTS content_analytics CASCADE',
          'DROP TABLE IF EXISTS user_follows CASCADE',
          'DROP TABLE IF EXISTS content_bookmarks CASCADE',
          'DROP TABLE IF EXISTS user_badges CASCADE',
          'DROP TABLE IF EXISTS content_urls CASCADE',
          'DROP TABLE IF EXISTS content CASCADE',
          'DROP TABLE IF EXISTS users CASCADE'
        ];

        for (const statement of dropStatements) {
          await client.query(statement);
        }

        const simplifiedStatements = [
          `CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            cognito_sub TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            profile_slug TEXT UNIQUE NOT NULL,
            default_visibility TEXT NOT NULL DEFAULT 'private',
            is_admin BOOLEAN NOT NULL DEFAULT false,
            is_aws_employee BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
          `CREATE TABLE IF NOT EXISTS content (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            content_type TEXT NOT NULL,
            visibility TEXT NOT NULL,
            publish_date TIMESTAMPTZ,
            capture_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            metrics JSONB DEFAULT '{}'::jsonb NOT NULL,
            tags TEXT[] DEFAULT '{}'::text[] NOT NULL,
            embedding JSONB,
            is_claimed BOOLEAN DEFAULT true NOT NULL,
            claimed_at TIMESTAMPTZ,
            original_author TEXT,
            is_flagged BOOLEAN DEFAULT false NOT NULL,
            flagged_at TIMESTAMPTZ,
            flagged_by TEXT,
            flag_reason TEXT,
            moderation_status TEXT DEFAULT 'approved' NOT NULL,
            moderated_at TIMESTAMPTZ,
            moderated_by UUID,
            deleted_at TIMESTAMPTZ,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS content_urls (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
            url TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            deleted_at TIMESTAMPTZ,
            UNIQUE(content_id, url)
          )`,
          `CREATE TABLE IF NOT EXISTS user_badges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
            badge_type TEXT NOT NULL,
            awarded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            awarded_by UUID,
            awarded_reason TEXT,
            metadata JSONB DEFAULT '{}'::jsonb,
            is_active BOOLEAN DEFAULT true NOT NULL,
            revoked_at TIMESTAMPTZ,
            revoked_by UUID,
            revoke_reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, badge_type)
          )`,
          `CREATE TABLE IF NOT EXISTS content_bookmarks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
            content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, content_id)
          )`,
          `CREATE TABLE user_follows (
            follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
            following_id UUID REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            PRIMARY KEY (follower_id, following_id)
          )`,
          `CREATE TABLE content_analytics (
            content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
            views_count INTEGER DEFAULT 0,
            likes_count INTEGER DEFAULT 0,
            shares_count INTEGER DEFAULT 0,
            comments_count INTEGER DEFAULT 0,
            engagement_score NUMERIC DEFAULT 0,
            last_updated TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL,
            url TEXT NOT NULL,
            name TEXT,
            enabled BOOLEAN DEFAULT true NOT NULL,
            last_sync_at TIMESTAMPTZ,
            last_sync_status TEXT,
            last_sync_error TEXT,
            sync_frequency TEXT DEFAULT 'daily' NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, url)
          )`,
          `CREATE TABLE analytics_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_type TEXT NOT NULL,
            user_id UUID,
            session_id TEXT,
            content_id UUID,
            metadata JSONB DEFAULT '{}'::jsonb,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE admin_actions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_user_id UUID,
            action_type TEXT NOT NULL,
            target_user_id UUID,
            target_content_id UUID,
            details JSONB DEFAULT '{}'::jsonb,
            ip_address TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS audit_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id UUID,
            old_values JSONB,
            new_values JSONB,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE saved_searches (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            filters JSONB DEFAULT '{}'::jsonb,
            is_public BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS duplicate_pairs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content_id_1 UUID NOT NULL,
            content_id_2 UUID NOT NULL,
            similarity_type TEXT NOT NULL,
            similarity_score NUMERIC,
            resolution TEXT DEFAULT 'pending' NOT NULL,
            detected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(content_id_1, content_id_2)
          )`,
          `CREATE TABLE IF NOT EXISTS user_consent (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            consent_type TEXT NOT NULL,
            granted BOOLEAN NOT NULL DEFAULT false,
            granted_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            consent_version TEXT DEFAULT '1.0' NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, consent_type)
          )`,
          `CREATE TABLE content_merge_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            primary_content_id UUID NOT NULL,
            merged_content_ids UUID[] NOT NULL,
            merged_by UUID,
            merge_reason TEXT,
            merged_metadata JSONB,
            can_undo BOOLEAN NOT NULL DEFAULT true,
            undo_deadline TIMESTAMPTZ,
            unmerged_at TIMESTAMPTZ,
            unmerged_by UUID,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
          )`
        ];

        for (const statement of simplifiedStatements) {
          await client.query(statement);
        }

      } else {
        await client.query(migrationSQL);

        const additionalMigrationPath = join(__dirname, '../../../src/backend/migrations/011_update_gdpr_export.sql');
        const additionalMigrationSQL = readFileSync(additionalMigrationPath, 'utf8');
        await client.query(additionalMigrationSQL);
      }

      // Ensure analytics table exists for tests that depend on it
      if (!useSimplifiedSchema) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS channels (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL,
            url TEXT NOT NULL,
            name TEXT,
            enabled BOOLEAN DEFAULT true NOT NULL,
            last_sync_at TIMESTAMPTZ,
            last_sync_status TEXT,
            last_sync_error TEXT,
            sync_frequency TEXT DEFAULT 'daily' NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, url)
          );
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS user_consent (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            consent_type TEXT NOT NULL,
            granted BOOLEAN NOT NULL DEFAULT false,
            granted_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            consent_version TEXT DEFAULT '1.0' NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
            UNIQUE(user_id, consent_type)
          );
        `);

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
      }

      if (beganTransaction) {
        await client.query('COMMIT');
      }
      testDbLog('Database migrations completed.');
    } catch (error: any) {
      if (beganTransaction) {
        await client.query('ROLLBACK');
      }
      // If vector-related operation fails, that's okay for tests
      if (useSimplifiedSchema) {
        testDbWarn('Migration step skipped during simplified migration:', error.message);
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
        await withTimeout(this.pool.end(), 30000, 'Closing test database pool');
      } catch (error: any) {
        if (!error?.code || error.code !== '57P01') {
          testDbWarn('Error while closing test database pool:', error);
        }
      } finally {
        this.pool = null;
      }
    }

    if (this.container) {
      try {
        await withTimeout(this.container.stop(), 30000, 'Stopping test database container');
      } catch (error) {
        testDbWarn('Error while stopping test database container:', (error as Error).message);
      } finally {
        this.container = null;
      }
    }

    this.pgMemDb = null;

    resetDatabaseCache();
    this.usageCount = 0;
  }

  public async clearData(): Promise<void> {
    if (!this.pool) {
      throw new Error('Pool not initialized');
    }

    // Clear all data but keep schema - only truncate tables that exist
    const tables = [
      'admin_actions',
      'analytics_events',
      'duplicate_pairs',
      'saved_searches',
      'user_consent',
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
        const message = typeof error?.message === 'string' ? error.message : '';
        if (error.code === '42P01' || message.includes('does not exist')) {  // undefined_table error code
          testDbLog(`Table ${table} does not exist, skipping truncate`);
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

  // Ensure application code reuses the test pool instead of opening new connections
  setTestDatabasePool(setup.pool);

  return setup;
};

export const teardownTestDatabase = async () => {
  await testDb.cleanup();
  };

export const resetTestData = async () => {
  await testDb.clearData();
};
