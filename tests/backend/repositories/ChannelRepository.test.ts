import { Pool } from 'pg';
import { ChannelRepository } from '../../../src/backend/repositories/ChannelRepository';
import { ChannelType } from '../../../src/shared/types';

describe('ChannelRepository', () => {
  let pool: Pool;
  let repository: ChannelRepository;
  let testUserId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:localpassword@localhost:5432/content_hub_dev',
    });

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (cognito_sub, email, username, profile_slug, default_visibility)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['test-sub-channel', 'channel-test@example.com', 'channeltest', 'channel-test', 'private']
    );
    testUserId = userResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM channels WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.end();
  });

  beforeEach(() => {
    repository = new ChannelRepository(pool);
  });

  afterEach(async () => {
    // Clean up channels after each test
    await pool.query('DELETE FROM channels WHERE user_id = $1', [testUserId]);
  });

  describe('create', () => {
    it('should create a new channel', async () => {
      const channel = await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example.com/feed',
        name: 'My Blog',
        syncFrequency: 'daily',
        metadata: { platform: 'wordpress' },
      });

      expect(channel).toBeDefined();
      expect(channel.id).toBeDefined();
      expect(channel.userId).toBe(testUserId);
      expect(channel.channelType).toBe(ChannelType.BLOG);
      expect(channel.url).toBe('https://example.com/feed');
      expect(channel.name).toBe('My Blog');
      expect(channel.enabled).toBe(true);
      expect(channel.syncFrequency).toBe('daily');
      expect(channel.metadata).toEqual({ platform: 'wordpress' });
    });

    it('should prevent duplicate url for same user', async () => {
      const url = 'https://example.com/feed-unique';

      await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url,
        syncFrequency: 'daily',
        metadata: {},
      });

      await expect(
        repository.create({
          userId: testUserId,
          channelType: ChannelType.BLOG,
          url,
          syncFrequency: 'daily',
          metadata: {},
        })
      ).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should find channel by id', async () => {
      const created = await repository.create({
        userId: testUserId,
        channelType: ChannelType.YOUTUBE,
        url: 'https://youtube.com/channel/test',
        syncFrequency: 'daily',
        metadata: {},
      });

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.channelType).toBe(ChannelType.YOUTUBE);
    });

    it('should return null for non-existent id', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all channels for a user', async () => {
      await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example1.com/feed',
        syncFrequency: 'daily',
        metadata: {},
      });

      await repository.create({
        userId: testUserId,
        channelType: ChannelType.YOUTUBE,
        url: 'https://youtube.com/channel/test1',
        syncFrequency: 'weekly',
        metadata: {},
      });

      const channels = await repository.findByUserId(testUserId);

      expect(channels).toHaveLength(2);
    });

    it('should return empty array for user with no channels', async () => {
      const channels = await repository.findByUserId('00000000-0000-0000-0000-000000000000');
      expect(channels).toEqual([]);
    });
  });

  describe('findActiveByType', () => {
    it('should find enabled channels by type', async () => {
      await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example1.com/feed',
        enabled: true,
        syncFrequency: 'daily',
        metadata: {},
      });

      await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example2.com/feed',
        enabled: false,
        syncFrequency: 'daily',
        metadata: {},
      });

      const channels = await repository.findActiveByType(ChannelType.BLOG);

      expect(channels).toHaveLength(1);
      expect(channels[0].enabled).toBe(true);
    });
  });

  describe('update', () => {
    it('should update channel properties', async () => {
      const channel = await repository.create({
        userId: testUserId,
        channelType: ChannelType.GITHUB,
        url: 'https://github.com/user/repo',
        name: 'Old Name',
        syncFrequency: 'daily',
        metadata: {},
      });

      const updated = await repository.update(channel.id, {
        name: 'New Name',
        enabled: false,
        syncFrequency: 'weekly',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('New Name');
      expect(updated?.enabled).toBe(false);
      expect(updated?.syncFrequency).toBe('weekly');
    });

    it('should return null for non-existent channel', async () => {
      const updated = await repository.update('00000000-0000-0000-0000-000000000000', {
        name: 'Test',
      });

      expect(updated).toBeNull();
    });
  });

  describe('updateSyncStatus', () => {
    it('should update sync status to success', async () => {
      const channel = await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example.com/feed',
        syncFrequency: 'daily',
        metadata: {},
      });

      const updated = await repository.updateSyncStatus(channel.id, 'success');

      expect(updated).toBeDefined();
      expect(updated?.lastSyncStatus).toBe('success');
      expect(updated?.lastSyncAt).toBeDefined();
      expect(updated?.lastSyncError).toBeUndefined();
    });

    it('should update sync status to error with message', async () => {
      const channel = await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example.com/feed',
        syncFrequency: 'daily',
        metadata: {},
      });

      const errorMessage = 'Failed to fetch feed';
      const updated = await repository.updateSyncStatus(channel.id, 'error', errorMessage);

      expect(updated).toBeDefined();
      expect(updated?.lastSyncStatus).toBe('error');
      expect(updated?.lastSyncError).toBe(errorMessage);
    });
  });

  describe('delete', () => {
    it('should delete channel by id', async () => {
      const channel = await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url: 'https://example.com/feed-delete',
        syncFrequency: 'daily',
        metadata: {},
      });

      const deleted = await repository.delete(channel.id);

      expect(deleted).toBe(true);

      const found = await repository.findById(channel.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent channel', async () => {
      const deleted = await repository.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  describe('findByUserIdAndUrl', () => {
    it('should find channel by user id and url', async () => {
      const url = 'https://example.com/unique-feed';
      await repository.create({
        userId: testUserId,
        channelType: ChannelType.BLOG,
        url,
        syncFrequency: 'daily',
        metadata: {},
      });

      const found = await repository.findByUserIdAndUrl(testUserId, url);

      expect(found).toBeDefined();
      expect(found?.url).toBe(url);
    });

    it('should return null if not found', async () => {
      const found = await repository.findByUserIdAndUrl(testUserId, 'https://nonexistent.com');
      expect(found).toBeNull();
    });
  });
});
