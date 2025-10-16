import { newDb } from 'pg-mem';
import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

describe('Database Integration', () => {
  let pool: Pool | null = null;
  let client: PoolClient | null = null;

  async function setupDatabase(): Promise<void> {
    const db = newDb({ autoCreateForeignKeyIndices: true });

    db.public.registerEnum('content_type', ['blog', 'youtube', 'github', 'conference_talk', 'podcast']);
    db.public.registerEnum('visibility_enum', ['private', 'aws_only', 'aws_community', 'public']);
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: 'uuid',
      implementation: () => uuidv4(),
    });

    db.public.none(`
      CREATE TABLE authors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        type content_type NOT NULL,
        visibility visibility_enum NOT NULL DEFAULT 'public',
        tags TEXT[] DEFAULT ARRAY[]::TEXT[],
        metrics JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX idx_content_author_id ON content(author_id);
      CREATE INDEX idx_content_type ON content(type);
      CREATE INDEX idx_content_visibility ON content(visibility);
    `);

    const adapter = db.adapters.createPg();
    const PoolClass = adapter.Pool;
    pool = new PoolClass();
    client = await pool.connect();
  }

  beforeEach(async () => {
    await setupDatabase();

    await client!.query('DELETE FROM content');
    await client!.query('DELETE FROM authors');

    const authorId = uuidv4();
    await client!.query(
      `INSERT INTO authors (id, name, email) VALUES ($1, $2, $3)`,
      [authorId, 'Test Author', 'author@example.com']
    );

    await client!.query(
      `INSERT INTO content (author_id, title, slug, type, visibility, tags, metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        authorId,
        'Serverless Patterns',
        'serverless-patterns',
        'blog',
        'public',
        ['serverless', 'lambda'],
        { views: 120 },
      ]
    );
  });

  afterEach(async () => {
    if (client) {
      client.release();
      client = null;
    }
    if (pool) {
      await pool.end();
      pool = null;
    }
  });

  describe('basic operations', () => {
    it('reads seeded content with author join', async () => {
      const result = await client!.query(
        `SELECT c.title, a.name AS author_name
         FROM content c
         JOIN authors a ON c.author_id = a.id`
      );

      expect(result.rowCount).toBe(1);
      expect(result.rows[0]).toMatchObject({
        title: 'Serverless Patterns',
        author_name: 'Test Author',
      });
    });

    it('updates metrics and timestamps on content', async () => {
      const update = await client!.query(
        `UPDATE content SET metrics = $1::jsonb, updated_at = NOW() RETURNING metrics`,
        [{ likes: 25 }]
      );

      expect(update.rowCount).toBe(1);
      expect(update.rows[0].metrics.likes).toBe(25);
    });

    it('deletes content when author is removed (cascade)', async () => {
      await client!.query('DELETE FROM authors');

      const count = await client!.query('SELECT COUNT(*)::int AS total FROM content');
      expect(count.rows[0].total).toBe(0);
    });
  });

  describe('constraints', () => {
    it('enforces unique slugs', async () => {
      const newAuthorId = uuidv4();
      await client!.query(
        `INSERT INTO authors (id, name, email) VALUES ($1, $2, $3)`,
        [newAuthorId, 'Second Author', 'author2@example.com']
      );

      await expect(
        client!.query(
          `INSERT INTO content (author_id, title, slug, type, visibility)
           VALUES ($1, $2, $3, $4, $5)`,
          [newAuthorId, 'Duplicate', 'serverless-patterns', 'blog', 'public']
        )
      ).rejects.toThrow();
    });

    it('rejects content when author is missing', async () => {
      await expect(
        client!.query(
          `INSERT INTO content (author_id, title, slug, type, visibility)
           VALUES ($1, $2, $3, $4, $5)`,
          ['00000000-0000-0000-0000-000000000000', 'Missing Author', 'missing-author', 'blog', 'public']
        )
      ).rejects.toThrow();
    });
  });

});
