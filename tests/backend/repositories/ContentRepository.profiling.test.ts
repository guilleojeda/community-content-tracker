import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { Visibility } from '@aws-community-hub/shared';
import type { Pool } from 'pg';

const createRecordingPool = () => {
  const executedSql: string[] = [];

  const pool = {
    query: jest.fn(async (sql: string) => {
      executedSql.push(sql);

      if (sql.startsWith('EXPLAIN ANALYZE')) {
        return { rows: [{ plan: 'Seq Scan' }] };
      }

      if (sql.includes("to_regclass('public.content_analytics')")) {
        return { rows: [{ table_exists: 'content_analytics' }] };
      }

      if (sql.includes('GROUP BY content_type')) {
        return { rows: [{ content_type: 'blog', count: 1 }] };
      }

      if (sql.includes('UNNEST(tags)')) {
        return { rows: [{ tag: 'lambda', count: 1 }] };
      }

      if (sql.includes("COALESCE((metrics->>'views')::int")) {
        return {
          rows: [{ id: 'c1', title: 'Top Content', content_type: 'blog', views: 10 }],
        };
      }

      if (sql.includes('analytics_events')) {
        return { rows: [{ date: new Date('2024-01-01'), views: '5' }] };
      }

      return { rows: [] };
    }),
  } as unknown as Pool;

  return { pool, executedSql };
};

describe('ContentRepository profiling', () => {
  const originalEnv = process.env.ENABLE_QUERY_PROFILING;

  afterEach(() => {
    process.env.ENABLE_QUERY_PROFILING = originalEnv;
    jest.restoreAllMocks();
  });

  it('runs EXPLAIN ANALYZE when profiling enabled for semantic search', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';

    const { pool, executedSql } = createRecordingPool();
    const repo = new ContentRepository(pool);
    jest.spyOn(repo as any, 'attachUrls').mockResolvedValue([]);

    await repo.semanticSearch([0.1, 0.2], {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    expect(executedSql.some(sql => sql.startsWith('EXPLAIN ANALYZE'))).toBe(true);
  });

  it('profiles keyword search queries when enabled', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';

    const { pool, executedSql } = createRecordingPool();
    const repo = new ContentRepository(pool);
    jest.spyOn(repo as any, 'attachUrls').mockResolvedValue([]);

    await repo.keywordSearch('aws', {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    expect(executedSql.some(sql => sql.startsWith('EXPLAIN ANALYZE'))).toBe(true);
  });
});
