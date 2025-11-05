/**
 * Real Database Integration Tests
 *
 * These tests run against a real PostgreSQL database with pgvector extension.
 * They test actual migration files and advanced database features including:
 * - Migration execution
 * - pgvector similarity search
 * - GDPR compliance functions (export_user_data, delete_user_data)
 * - Soft delete/restore for content
 * - Badge operations
 * - Content merge history
 *
 * Prerequisites:
 * - PostgreSQL 15+ with pgvector extension running
 * - DATABASE_URL environment variable set (defaults to test_db connection)
 *
 * In CI, this is provided by the postgres service container in .github/workflows/ci.yml
 */

import { Pool } from 'pg';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { testDb, TestDatabaseSetup } from '../backend/repositories/test-setup';

const shouldSkipRealDbTests = process.env.SKIP_REAL_DB_TESTS === 'true';

(shouldSkipRealDbTests ? describe.skip : describe)('Real Database Integration Tests', () => {
  let pool: Pool;
  let setup: TestDatabaseSetup;

  beforeAll(async () => {
    setup = await testDb.setup();
    pool = setup.pool;

    // Run migrations
    await runMigrations();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
    await testDb.cleanup();
  });

  /**
   * Run all migration files in order
   */
  async function runMigrations(): Promise<void> {
    const migrationsDir = path.join(__dirname, '../../src/backend/migrations');
    const migrationFiles = [
      '20240101000000000_initial_schema.sql',
      '20240115000000000_sprint_3_additions.sql',
      '20240201000000000_create_channels_table.sql',
      '20240215000000000_add_user_profile_fields.sql',
      '20240301000000000_add_missing_user_fields.sql',
    ];

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsDir, file);

      try {
        const sql = await fs.readFile(migrationPath, 'utf-8');
        await pool.query(sql);
        console.log(`✓ Migration ${file} executed successfully`);
      } catch (error) {
        // Check if error is because tables already exist (migrations already ran)
        if (error instanceof Error && error.message.includes('already exists')) {
          console.log(`→ Migration ${file} already applied`);
          continue;
        }
        console.error(`✗ Migration ${file} failed:`, error);
        throw error;
      }
    }
  }

  /**
   * Clean up test data created during tests
   */
  async function cleanupTestData(): Promise<void> {
    await testDb.clearData();
  }

  describe('Migration Validation', () => {
    it('should have all required tables', async () => {
      const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      const tableNames = result.rows.map(r => r.table_name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('content');
      expect(tableNames).toContain('content_urls');
      expect(tableNames).toContain('user_badges');
      expect(tableNames).toContain('channels');
      expect(tableNames).toContain('audit_log');
      expect(tableNames).toContain('content_merge_history');
    });

    it('should have pgvector extension installed', async () => {
      const result = await pool.query(`
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) as has_pgvector
      `);

      expect(result.rows[0].has_pgvector).toBe(true);
    });

    it('should have all content types in enum', async () => {
      const result = await pool.query(`
        SELECT e.enumlabel as value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'content_type_enum'
        ORDER BY e.enumsortorder
      `);

      const contentTypes = result.rows.map(r => r.value);

      expect(contentTypes).toContain('blog');
      expect(contentTypes).toContain('youtube');
      expect(contentTypes).toContain('github');
      expect(contentTypes).toContain('conference_talk');
      expect(contentTypes).toContain('podcast');
      expect(contentTypes).toContain('social');
      expect(contentTypes).toContain('whitepaper');
      expect(contentTypes).toContain('tutorial');
      expect(contentTypes).toContain('workshop');
      expect(contentTypes).toContain('book');
    });

    it('should include all visibility levels in enum', async () => {
      const result = await pool.query(`
        SELECT e.enumlabel as value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'visibility_enum'
        ORDER BY e.enumsortorder
      `);

      const visibilityValues = result.rows.map(r => r.value);

      expect(visibilityValues).toContain('private');
      expect(visibilityValues).toContain('aws_only');
      expect(visibilityValues).toContain('aws_community');
      expect(visibilityValues).toContain('public');
      expect(visibilityValues).toHaveLength(4);
    });

    it('should include all badge types in enum', async () => {
      const result = await pool.query(`
        SELECT e.enumlabel as value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'badge_enum'
        ORDER BY e.enumsortorder
      `);

      const badgeValues = result.rows.map(r => r.value);

      expect(badgeValues).toContain('community_builder');
      expect(badgeValues).toContain('hero');
      expect(badgeValues).toContain('ambassador');
      expect(badgeValues).toContain('user_group_leader');
      expect(badgeValues).toHaveLength(4);
    });

    it('should create required indexes for core tables', async () => {
      const { rows: userIndexes } = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'users'
      `);

      const userIndexNames = userIndexes.map((row) => row.indexname);
      expect(userIndexNames).toEqual(expect.arrayContaining([
        'idx_users_email',
        'idx_users_username',
        'idx_users_profile_slug',
        'idx_users_cognito_sub',
      ]));

      const { rows: contentIndexes } = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'content'
      `);

      const contentIndexNames = contentIndexes.map((row) => row.indexname);
      expect(contentIndexNames).toEqual(expect.arrayContaining([
        'idx_content_user_id',
        'idx_content_visibility',
        'idx_content_content_type',
        'idx_content_embedding',
      ]));
    });
  });

  describe('User Operations', () => {
    let testUserId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'user@test.example.com', 'testuser', 'testuser', 'private', false, false]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should create and retrieve user', async () => {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [testUserId]);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].email).toBe('user@test.example.com');
      expect(result.rows[0].username).toBe('testuser');
    });

    it('should enforce unique email constraint', async () => {
      await expect(
        pool.query(`
          INSERT INTO users (cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [`cognito-${uuidv4()}`, 'user@test.example.com', 'testuser2', 'testuser2', 'private', false, false])
      ).rejects.toThrow();
    });
  });

  describe('Seed Script Validation', () => {
    const originalEnv = { ...process.env };

    afterEach(async () => {
      process.env = { ...originalEnv };
      await testDb.clearData();
    });

    it('should populate development seed data without errors', async () => {
      process.env.DATABASE_URL = setup.connectionString;
      process.env.DATABASE_POOL_MIN = '1';
      process.env.DATABASE_POOL_MAX = '5';

      jest.resetModules();
      const { seedDatabase } = await import('../../src/backend/src/database/seeds/seed');
      await seedDatabase();

      const adminResult = await pool.query(
        `SELECT username, is_admin FROM users WHERE email = 'admin@aws-community.dev'`
      );
      expect(adminResult.rowCount).toBe(1);
      expect(adminResult.rows[0].is_admin).toBe(true);

      const { rows: contentCountRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM content`);
      expect(contentCountRows[0].count).toBeGreaterThanOrEqual(5);

      const { rows: badgeRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM user_badges`);
      expect(badgeRows[0].count).toBeGreaterThan(0);

      const databaseModule = await import('../../src/backend/src/database/config/database');
      await databaseModule.db.end?.();
    });
  });

  describe('Content Operations with pgvector', () => {
    let testUserId: string;
    let testContentId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      testContentId = uuidv4();

      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'content-user@test.example.com', 'contentuser', 'contentuser', 'private', false, false]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM content WHERE id = $1', [testContentId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should create content with embedding vector', async () => {
      const embedding = Array.from({ length: 1536 }, () => Math.random());

      await pool.query(`
        INSERT INTO content (id, user_id, title, description, content_type, visibility, embedding, is_claimed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testContentId, testUserId, 'AWS Lambda Tutorial', 'Learn serverless computing', 'tutorial', 'public', JSON.stringify(embedding), true]);

      const result = await pool.query('SELECT * FROM content WHERE id = $1', [testContentId]);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].content_type).toBe('tutorial');
      expect(result.rows[0].embedding).toBeTruthy();
    });

    it('should perform vector similarity search', async () => {
      // Create multiple content items with embeddings
      const embedding1 = Array.from({ length: 1536 }, (_, i) => i < 100 ? 1.0 : 0.0);
      const embedding2 = Array.from({ length: 1536 }, (_, i) => i < 100 ? 0.9 : 0.1);
      const embedding3 = Array.from({ length: 1536 }, (_, i) => i < 100 ? 0.1 : 0.9);

      const content1Id = uuidv4();
      const content2Id = uuidv4();
      const content3Id = uuidv4();

      await pool.query(`
        INSERT INTO content (id, user_id, title, content_type, visibility, embedding, is_claimed)
        VALUES
          ($1, $2, 'Serverless Lambda', 'blog', 'public', $3, true),
          ($4, $2, 'Lambda Patterns', 'blog', 'public', $5, true),
          ($6, $2, 'EC2 Basics', 'blog', 'public', $7, true)
      `, [content1Id, testUserId, JSON.stringify(embedding1),
          content2Id, JSON.stringify(embedding2),
          content3Id, JSON.stringify(embedding3)]);

      // Search for content similar to embedding1
      const searchEmbedding = embedding1;
      const result = await pool.query(`
        SELECT id, title, 1 - (embedding <=> $1::vector) as similarity
        FROM content
        WHERE user_id = $2
        ORDER BY embedding <=> $1::vector
        LIMIT 2
      `, [JSON.stringify(searchEmbedding), testUserId]);

      expect(result.rowCount).toBe(2);
      // First result should be content1 (exact match)
      expect(result.rows[0].id).toBe(content1Id);
      expect(result.rows[0].similarity).toBeCloseTo(1.0, 1);
      // Second result should be content2 (similar)
      expect(result.rows[1].id).toBe(content2Id);

      // Cleanup
      await pool.query('DELETE FROM content WHERE id IN ($1, $2, $3)', [content1Id, content2Id, content3Id]);
    });
  });

  describe('Soft Delete and Restore', () => {
    let testUserId: string;
    let testContentId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      testContentId = uuidv4();

      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'delete-user@test.example.com', 'deleteuser', 'deleteuser', 'private', false, false]);

      await pool.query(`
        INSERT INTO content (id, user_id, title, content_type, visibility, is_claimed)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [testContentId, testUserId, 'Test Content', 'blog', 'public', true]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM content WHERE id = $1', [testContentId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should soft delete content using function', async () => {
      await pool.query('SELECT soft_delete_content($1)', [testContentId]);

      const result = await pool.query('SELECT deleted_at FROM content WHERE id = $1', [testContentId]);

      expect(result.rows[0].deleted_at).toBeTruthy();
    });

    it('should restore soft-deleted content using function', async () => {
      // Soft delete
      await pool.query('SELECT soft_delete_content($1)', [testContentId]);

      // Restore
      await pool.query('SELECT restore_content($1)', [testContentId]);

      const result = await pool.query('SELECT deleted_at FROM content WHERE id = $1', [testContentId]);

      expect(result.rows[0].deleted_at).toBeNull();
    });
  });

  describe('GDPR Compliance Functions', () => {
    let testUserId: string;
    let testContentId: string;
    let testBadgeId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      testContentId = uuidv4();
      testBadgeId = uuidv4();

      // Create user
      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'gdpr-user@test.example.com', 'gdpruser', 'gdpruser', 'private', false, false]);

      // Create content
      await pool.query(`
        INSERT INTO content (id, user_id, title, content_type, visibility, is_claimed)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [testContentId, testUserId, 'GDPR Test Content', 'blog', 'public', true]);

      // Create badge
      await pool.query(`
        INSERT INTO user_badges (id, user_id, badge_type, awarded_at)
        VALUES ($1, $2, $3, NOW())
      `, [testBadgeId, testUserId, 'hero']);
    });

    afterEach(async () => {
      // Clean up (if not deleted by test)
      await pool.query('DELETE FROM user_badges WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM content WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should export user data using GDPR function', async () => {
      const result = await pool.query('SELECT export_user_data($1)', [testUserId]);

      const exportData = result.rows[0].export_user_data;

      expect(exportData).toBeTruthy();
      expect(exportData.user).toBeTruthy();
      expect(exportData.user.email).toBe('gdpr-user@test.example.com');
      expect(exportData.content).toBeTruthy();
      expect(Array.isArray(exportData.content)).toBe(true);
      expect(exportData.content.length).toBeGreaterThan(0);
      expect(exportData.badges).toBeTruthy();
      expect(Array.isArray(exportData.badges)).toBe(true);
    });

    it('should delete user data using GDPR function', async () => {
      await pool.query('SELECT delete_user_data($1)', [testUserId]);

      // Verify user is deleted
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [testUserId]);
      expect(userResult.rowCount).toBe(0);

      // Verify content is deleted (cascade)
      const contentResult = await pool.query('SELECT * FROM content WHERE user_id = $1', [testUserId]);
      expect(contentResult.rowCount).toBe(0);

      // Verify badges are deleted (cascade)
      const badgeResult = await pool.query('SELECT * FROM user_badges WHERE user_id = $1', [testUserId]);
      expect(badgeResult.rowCount).toBe(0);
    });
  });

  describe('Badge Operations', () => {
    let testUserId: string;

    beforeEach(async () => {
      testUserId = uuidv4();

      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'badge-user@test.example.com', 'badgeuser', 'badgeuser', 'private', false, false]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM user_badges WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should grant and revoke badges', async () => {
      const badgeId = uuidv4();

      // Grant badge
      await pool.query(`
        INSERT INTO user_badges (id, user_id, badge_type, awarded_at, awarded_by)
        VALUES ($1, $2, $3, NOW(), $4)
      `, [badgeId, testUserId, 'community_builder', testUserId]);

      // Verify badge exists and is active
      let result = await pool.query('SELECT * FROM user_badges WHERE id = $1', [badgeId]);
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].is_active).toBe(true);
      expect(result.rows[0].revoked_at).toBeNull();

      // Revoke badge
      await pool.query(`
        UPDATE user_badges
        SET is_active = false, revoked_at = NOW(), revoked_by = $1, revoke_reason = $2
        WHERE id = $3
      `, [testUserId, 'Testing revocation', badgeId]);

      // Verify badge is revoked
      result = await pool.query('SELECT * FROM user_badges WHERE id = $1', [badgeId]);
      expect(result.rows[0].is_active).toBe(false);
      expect(result.rows[0].revoked_at).toBeTruthy();
      expect(result.rows[0].revoke_reason).toBe('Testing revocation');
    });

    it('should track badge metadata', async () => {
      const badgeId = uuidv4();
      const metadata = { verification: 'email-domain', domain: 'aws.amazon.com' };

      await pool.query(`
        INSERT INTO user_badges (id, user_id, badge_type, awarded_at, metadata)
        VALUES ($1, $2, $3, NOW(), $4)
      `, [badgeId, testUserId, 'hero', JSON.stringify(metadata)]);

      const result = await pool.query('SELECT metadata FROM user_badges WHERE id = $1', [badgeId]);

      expect(result.rows[0].metadata).toEqual(metadata);
    });
  });

  describe('Content Merge History', () => {
    let testUserId: string;
    let sourceContentId: string;
    let targetContentId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      sourceContentId = uuidv4();
      targetContentId = uuidv4();

      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'merge-user@test.example.com', 'mergeuser', 'mergeuser', 'private', false, false]);

      await pool.query(`
        INSERT INTO content (id, user_id, title, content_type, visibility, is_claimed)
        VALUES
          ($1, $2, 'Source Content', 'blog', 'public', true),
          ($3, $2, 'Target Content', 'blog', 'public', true)
      `, [sourceContentId, testUserId, targetContentId]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM content_merge_history WHERE source_content_id = $1', [sourceContentId]);
      await pool.query('DELETE FROM content WHERE id IN ($1, $2)', [sourceContentId, targetContentId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should track content merge history', async () => {
      const mergeId = uuidv4();

      await pool.query(`
        INSERT INTO content_merge_history (id, source_content_id, target_content_id, merged_by, merged_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [mergeId, sourceContentId, targetContentId, testUserId]);

      const result = await pool.query('SELECT * FROM content_merge_history WHERE id = $1', [mergeId]);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].source_content_id).toBe(sourceContentId);
      expect(result.rows[0].target_content_id).toBe(targetContentId);
      expect(result.rows[0].merged_by).toBe(testUserId);
    });

    it('should allow content to be unmerged', async () => {
      const mergeId = uuidv4();

      // Record merge
      await pool.query(`
        INSERT INTO content_merge_history (id, source_content_id, target_content_id, merged_by, merged_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [mergeId, sourceContentId, targetContentId, testUserId]);

      // Record unmerge
      await pool.query(`
        UPDATE content_merge_history
        SET unmerged_at = NOW(), unmerged_by = $1
        WHERE id = $2
      `, [testUserId, mergeId]);

      const result = await pool.query('SELECT * FROM content_merge_history WHERE id = $1', [mergeId]);

      expect(result.rows[0].unmerged_at).toBeTruthy();
      expect(result.rows[0].unmerged_by).toBe(testUserId);
    });
  });

  describe('Channel Operations', () => {
    let testUserId: string;
    let testChannelId: string;

    beforeEach(async () => {
      testUserId = uuidv4();
      testChannelId = uuidv4();

      await pool.query(`
        INSERT INTO users (id, cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [testUserId, `cognito-${testUserId}`, 'channel-user@test.example.com', 'channeluser', 'channeluser', 'private', false, false]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM channels WHERE id = $1', [testChannelId]);
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    });

    it('should create and manage channels', async () => {
      await pool.query(`
        INSERT INTO channels (id, user_id, channel_type, url, name, enabled, sync_frequency)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [testChannelId, testUserId, 'blog', 'https://example.com/rss', 'Test Blog', true, 'daily']);

      const result = await pool.query('SELECT * FROM channels WHERE id = $1', [testChannelId]);

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].channel_type).toBe('blog');
      expect(result.rows[0].enabled).toBe(true);
    });

    it('should track channel sync status', async () => {
      await pool.query(`
        INSERT INTO channels (id, user_id, channel_type, url, name, enabled, sync_frequency)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [testChannelId, testUserId, 'youtube', 'https://youtube.com/channel/test', 'Test Channel', true, 'daily']);

      // Update sync status
      await pool.query(`
        UPDATE channels
        SET last_sync_at = NOW(), last_sync_status = $1
        WHERE id = $2
      `, ['success', testChannelId]);

      const result = await pool.query('SELECT * FROM channels WHERE id = $1', [testChannelId]);

      expect(result.rows[0].last_sync_status).toBe('success');
      expect(result.rows[0].last_sync_at).toBeTruthy();
    });
  });
});
