import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { Visibility } from '@aws-community-hub/shared';
import type { Pool } from 'pg';

describe('ContentRepository profiling', () => {
  const originalEnv = process.env.ENABLE_QUERY_PROFILING;

  afterEach(() => {
    process.env.ENABLE_QUERY_PROFILING = originalEnv;
  });

  it('runs EXPLAIN ANALYZE when profiling enabled for semantic search', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';

    const repo = new ContentRepository({} as unknown as Pool);
    jest.spyOn(repo as any, 'attachUrls').mockResolvedValue([]);
    const executeSpy = jest.spyOn(repo as any, 'executeQuery').mockResolvedValue({ rows: [] });

    await repo.semanticSearch([0.1, 0.2], {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    const explainCalls = executeSpy.mock.calls.filter(([sql]) => String(sql).includes('EXPLAIN ANALYZE'));
    expect(explainCalls).toHaveLength(1);
  });

  it('profiles keyword search queries when enabled', async () => {
    process.env.ENABLE_QUERY_PROFILING = 'true';

    const repo = new ContentRepository({} as unknown as Pool);
    jest.spyOn(repo as any, 'attachUrls').mockResolvedValue([]);
    const executeSpy = jest.spyOn(repo as any, 'executeQuery').mockResolvedValue({ rows: [] });

    await repo.keywordSearch('aws', {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    const explainCalls = executeSpy.mock.calls.filter(([sql]) => String(sql).includes('EXPLAIN ANALYZE'));
    expect(explainCalls).toHaveLength(1);
  });
});
