import { Pool } from 'pg';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../backend/repositories/test-setup';

describe('Database Integration (Schema Smoke Tests)', () => {
  let pool: Pool;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  it('creates and retrieves a user with default visibility', async () => {
    const newUser = await createTestUser(pool, {
      username: 'schemauser',
      email: 'schema@example.com',
    });

    const { rows } = await pool.query(
      'SELECT username, default_visibility FROM users WHERE id = $1',
      [newUser.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe('schemauser');
    expect(rows[0].default_visibility).toBe('private');
  });

  it('enforces unique email constraint on users', async () => {
    const baseUser = await createTestUser(pool, {
      email: 'duplicate@example.com',
    });

    await expect(
      pool.query(
        `INSERT INTO users (cognito_sub, email, username, profile_slug, default_visibility, is_admin, is_aws_employee)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `dup-sub-${Date.now()}`,
          baseUser.email,
          `dup-user-${Date.now()}`,
          `dup-slug-${Date.now()}`,
          'private',
          false,
          false,
        ]
      )
    ).rejects.toThrow();
  });

  it('cascades content deletion when owner is removed', async () => {
    const owner = await createTestUser(pool, { username: 'contentowner' });
    const content = await createTestContent(pool, owner.id, { title: 'Cascade Test', visibility: 'public' });

    await pool.query('DELETE FROM users WHERE id = $1', [owner.id]);

    const { rows } = await pool.query('SELECT * FROM content WHERE id = $1', [content.id]);
    expect(rows).toHaveLength(0);
  });

  it('persists tags and metrics defaults for content records', async () => {
    const owner = await createTestUser(pool, { username: 'tagowner' });
    const content = await createTestContent(pool, owner.id, {
      visibility: 'aws_community',
      tags: ['aws', 'community'],
      description: 'Schema test content',
    });

    const { rows } = await pool.query(
      'SELECT tags, metrics, visibility FROM content WHERE id = $1',
      [content.id]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].tags).toEqual(['aws', 'community']);
    expect(rows[0].metrics).toEqual({});
    expect(rows[0].visibility).toBe('aws_community');
  });
});
