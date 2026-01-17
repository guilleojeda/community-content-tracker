import { Pool } from 'pg';
import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { Visibility } from '@aws-community-hub/shared';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
  createTestContent,
} from '../repositories/test-setup';

describe('ContentRepository keyword search sanitisation', () => {
  let pool: Pool;
  let repo: ContentRepository;
  let userId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    repo = new ContentRepository(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    const user = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
    userId = user.id;
    await createTestContent(pool, userId, {
      title: 'Safe Entry',
      description: 'Neutral description',
      visibility: 'public',
    });
  });

  it('does not execute injected SQL during keyword search', async () => {
    const payload = "' OR 1=1; DROP TABLE content; --";

    const results = await repo.keywordSearch(payload, {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    expect(results).toHaveLength(0);

    const countResult = await pool.query('SELECT COUNT(*) FROM content');
    expect(Number(countResult.rows[0].count)).toBe(1);
  });
});
