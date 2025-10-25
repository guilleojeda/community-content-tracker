import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { Visibility } from '@aws-community-hub/shared';

describe('ContentRepository keyword search sanitisation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses parameterised queries for keyword search', async () => {
    const repo = new ContentRepository({} as any);
    const executeQueryMock = jest
      .spyOn(repo as any, 'executeQuery')
      .mockResolvedValue({ rows: [] });
    jest.spyOn(repo as any, 'attachUrls').mockResolvedValue([]);

    const payload = "' OR 1=1; DROP TABLE content; --";

    await repo.keywordSearch(payload, {
      visibilityLevels: [Visibility.PUBLIC],
      limit: 5,
      offset: 0,
    });

    expect(executeQueryMock).toHaveBeenCalled();
    const [sql, params] = executeQueryMock.mock.calls[0];
    expect(sql).toContain("plainto_tsquery('english', $1)");
    expect(sql).not.toContain(payload);
    expect(params[0]).toBe(payload);
  });
});
