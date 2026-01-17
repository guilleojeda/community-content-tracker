import { handleLocalApiRequest, resetLocalApiState } from '@/lib/local-api';
import { BadgeType, ChannelType, ContentType, User, Visibility } from '@shared/types';

const makeRequest = (
  method: string,
  path: string,
  options: {
    token?: string;
    query?: Record<string, string>;
    body?: unknown;
  } = {}
) =>
  handleLocalApiRequest({
    method,
    path: path.split('/').filter(Boolean),
    query: new URLSearchParams(options.query ?? {}),
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    body: options.body,
  });

describe('local api handler', () => {
  beforeEach(() => {
    resetLocalApiState();
  });

  it('returns public search results', () => {
    const response = makeRequest('GET', '/search', { query: { q: 'lambda' } });
    const body = response.body as { items: Array<{ title: string }> };
    expect(response.status).toBe(200);
    expect(body.items.some(item => item.title === 'AWS Lambda Deep Dive')).toBe(true);
  });

  it('creates and lists content for authenticated users', () => {
    const token = 'test-token-chromium';
    const createResponse = makeRequest('POST', '/content', {
      token,
      body: {
        title: 'Content blog',
        contentType: ContentType.BLOG,
        visibility: Visibility.PUBLIC,
        urls: ['https://example.com/blog'],
        tags: ['lambda'],
      },
    });
    expect(createResponse.status).toBe(200);

    const listResponse = makeRequest('GET', '/content', { token });
    const listBody = listResponse.body as { content: Array<{ title: string }> };
    expect(listBody.content.map(item => item.title)).toContain('Content blog');
  });

  it('supports unclaimed content and claim flow', () => {
    const token = 'test-token-chromium';
    const listResponse = makeRequest('GET', '/content/unclaimed', {
      token,
      query: { contentType: ContentType.BLOG },
    });
    const listBody = listResponse.body as { content: Array<{ id: string; title: string }> };
    const item = listBody.content[0];
    expect(item.title).toBe(`Unclaimed chromium ${ContentType.BLOG}`);

    const claimResponse = makeRequest('POST', `/content/${item.id}/claim`, { token });
    expect((claimResponse.body as { success: boolean }).success).toBe(true);

    const afterResponse = makeRequest('GET', '/content/unclaimed', {
      token,
      query: { contentType: ContentType.BLOG },
    });
    const afterBody = afterResponse.body as { content: Array<{ id: string }> };
    expect(afterBody.content.some(entry => entry.id === item.id)).toBe(false);
  });

  it('manages channels and sync status', () => {
    const token = 'test-token-chromium';
    const createResponse = makeRequest('POST', '/channels', {
      token,
      body: {
        channelType: ChannelType.BLOG,
        url: 'https://example.com/rss.xml',
        name: 'Creator Feed',
      },
    });
    const channel = createResponse.body as { id: string };
    const syncResponse = makeRequest('POST', `/channels/${channel.id}/sync`, { token });
    expect((syncResponse.body as { message: string }).message).toBe('Sync started successfully');
  });

  it('updates badges for admin users', () => {
    const token = 'admin-token-firefox';
    const listResponse = makeRequest('GET', '/admin/users', { token });
    const listBody = listResponse.body as { users: Array<{ id: string; username: string }> };
    const builder = listBody.users.find(user => user.username === 'builder-firefox');
    expect(builder).toBeTruthy();

    makeRequest('POST', '/admin/badges', {
      token,
      body: { userId: builder!.id, badgeType: BadgeType.COMMUNITY_BUILDER },
    });

    const detailResponse = makeRequest('GET', `/admin/users/${builder!.id}`, { token });
    const detailBody = detailResponse.body as { badges: Array<{ badgeType: BadgeType }> };
    expect(detailBody.badges.some(badge => badge.badgeType === BadgeType.COMMUNITY_BUILDER)).toBe(true);
  });

  it('records export history entries', () => {
    const token = 'test-token-chromium';
    const exportResponse = makeRequest('POST', '/export/csv', {
      token,
      body: { programType: BadgeType.COMMUNITY_BUILDER },
    });
    expect(exportResponse.isJson).toBe(false);

    const historyResponse = makeRequest('GET', '/export/history', { token });
    const historyBody = historyResponse.body as { history: Array<{ id: string }> };
    expect(historyBody.history.length).toBeGreaterThan(0);
  });

  it('exports user data for authenticated users', () => {
    const token = 'test-token-chromium';
    const meResponse = makeRequest('GET', '/users/me', { token });
    const user = meResponse.body as User;

    const exportResponse = makeRequest('GET', `/users/${user.id}/export`, { token });
    const exportBody = exportResponse.body as { user: User };
    expect(exportBody.user.id).toBe(user.id);
  });
});
