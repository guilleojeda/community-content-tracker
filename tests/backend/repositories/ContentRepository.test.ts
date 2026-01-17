import { Pool } from 'pg';
import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { BadgeType, Content, ContentType, Visibility } from '@aws-community-hub/shared';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from './test-setup';

describe('ContentRepository', () => {
  let pool: Pool;
  let contentRepository: ContentRepository;
  let testUserId: string;
  let adminUserId: string;
  let awsEmployeeUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    contentRepository = new ContentRepository(pool);

    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } catch (error) {
      console.warn('pg_trgm extension unavailable in test environment, skipping.');
    }
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    await pool.query('ALTER TABLE content ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ');

    // Create test users
    const testUser = await createTestUser(pool, {
      username: 'testuser',
      isAdmin: false,
      isAwsEmployee: false,
    });
    testUserId = testUser.id;

    const adminUser = await createTestUser(pool, {
      username: 'adminuser',
      isAdmin: true,
      isAwsEmployee: false,
    });
    adminUserId = adminUser.id;

    const awsEmployee = await createTestUser(pool, {
      username: 'awsemployee',
      isAdmin: false,
      isAwsEmployee: true,
    });
    awsEmployeeUserId = awsEmployee.id;
  });

  describe('identifier-based lookups and aggregations', () => {
    it('should find content by ids including URLs', async () => {
      const content = await createTestContent(pool, testUserId, { title: 'URL Article' });
      await pool.query(
        `INSERT INTO content_urls (content_id, url) VALUES ($1, $2)`,
        [content.id, 'https://example.com/resource']
      );

      const results = await contentRepository.findByIds([content.id]);
      expect(results).toHaveLength(1);
      expect(results[0].urls).toHaveLength(1);
      expect(results[0].urls[0].url).toBe('https://example.com/resource');
    });

    it('should return popular tags sorted by frequency', async () => {
      if (process.env.TEST_DB_INMEMORY === 'true') {
        return;
      }
      await createTestContent(pool, testUserId, { tags: ['aws', 'serverless'], visibility: 'public' });
      await createTestContent(pool, adminUserId, { tags: ['aws'], visibility: 'public' });
      await createTestContent(pool, awsEmployeeUserId, { tags: ['frontend'], visibility: 'public' });

      const popular = await contentRepository.getPopularTags(2);
      expect(popular).toEqual([
        { tag: 'aws', count: 2 },
        { tag: 'serverless', count: 1 },
      ]);
    });
  });

  describe('findByIdForViewer', () => {
    it('returns private content for the owner and admin', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: 'private',
      });

      const ownerResult = await contentRepository.findByIdForViewer(content.id, testUserId);
      expect(ownerResult?.id).toBe(content.id);

      const adminResult = await contentRepository.findByIdForViewer(content.id, adminUserId);
      expect(adminResult?.id).toBe(content.id);
    });

    it('returns null for unauthorized viewers', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: 'private',
      });

      const otherUser = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const result = await contentRepository.findByIdForViewer(content.id, otherUser.id);

      expect(result).toBeNull();
    });

    it('returns public content to anonymous viewers', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: 'public',
      });

      const result = await contentRepository.findByIdForViewer(content.id, null);
      expect(result?.id).toBe(content.id);
    });
  });

  describe('findByUserId', () => {
    it('should find all content for a user', async () => {
      const content1 = await createTestContent(pool, testUserId, { title: 'Content 1' });
      const content2 = await createTestContent(pool, testUserId, { title: 'Content 2' });
      await createTestContent(pool, adminUserId, { title: 'Admin Content' });

      const results = await contentRepository.findByUserId(testUserId);

      expect(results).toHaveLength(2);
      expect(results.map(c => c.id)).toContain(content1.id);
      expect(results.map(c => c.id)).toContain(content2.id);
    });

    it('should apply visibility filtering when viewer is provided', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: 'private',
      });
      const publicContent = await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: 'public',
      });

      // Viewer as different user should only see public content
      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.findByUserId(testUserId, { viewerId: regularViewer.id });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicContent.id);
    });

    it('should show all content when viewer is the owner', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: 'private',
      });
      await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: 'public',
      });

      const results = await contentRepository.findByUserId(testUserId, { viewerId: testUserId });

      expect(results).toHaveLength(2);
    });
  });

  describe('findByContentType', () => {
    it('should find content by type', async () => {
      const blogContent = await createTestContent(pool, testUserId, {
        contentType: 'blog',
        visibility: 'public',
      });
      const videoContent = await createTestContent(pool, testUserId, {
        contentType: 'youtube',
        visibility: 'public',
      });

      const blogResults = await contentRepository.findByContentType(ContentType.BLOG);
      const videoResults = await contentRepository.findByContentType(ContentType.YOUTUBE);

      expect(blogResults).toHaveLength(1);
      expect(blogResults[0].id).toBe(blogContent.id);
      expect(videoResults).toHaveLength(1);
      expect(videoResults[0].id).toBe(videoContent.id);
    });

    it('should apply visibility filtering', async () => {
      await createTestContent(pool, testUserId, {
        contentType: 'blog',
        visibility: 'private',
      });
      const publicBlog = await createTestContent(pool, testUserId, {
        contentType: 'blog',
        visibility: 'public',
      });

      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.findByContentType(ContentType.BLOG, {
        viewerId: regularViewer.id,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicBlog.id);
    });
  });

  describe('findByVisibility', () => {
    it('should find content by visibility level', async () => {
      const privateContent = await createTestContent(pool, testUserId, {
        visibility: 'private',
      });
      const publicContent = await createTestContent(pool, testUserId, {
        visibility: 'public',
      });

      const privateResults = await contentRepository.findByVisibility(Visibility.PRIVATE);
      const publicResults = await contentRepository.findByVisibility(Visibility.PUBLIC);

      expect(privateResults).toHaveLength(1);
      expect(privateResults[0].id).toBe(privateContent.id);
      expect(publicResults).toHaveLength(1);
      expect(publicResults[0].id).toBe(publicContent.id);
    });
  });

  describe('findPublicContent', () => {
    it('should find all public content', async () => {
      await createTestContent(pool, testUserId, { visibility: 'private' });
      const publicContent1 = await createTestContent(pool, testUserId, { visibility: 'public' });
      const publicContent2 = await createTestContent(pool, adminUserId, { visibility: 'public' });

      const results = await contentRepository.findPublicContent();

      expect(results).toHaveLength(2);
      expect(results.map(c => c.id)).toContain(publicContent1.id);
      expect(results.map(c => c.id)).toContain(publicContent2.id);
    });

    it('should apply pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestContent(pool, testUserId, { visibility: 'public', title: `Content ${i}` });
      }

      const results = await contentRepository.findPublicContent({ limit: 3 });

      expect(results).toHaveLength(3);
    });
  });

  describe('searchContent', () => {
    it('should search by title', async () => {
      const targetContent = await createTestContent(pool, testUserId, {
        title: 'AWS Lambda Best Practices',
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'React Components Guide',
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('lambda');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(targetContent.id);
    });

    it('should search by description', async () => {
      const targetContent = await createTestContent(pool, testUserId, {
        title: 'Serverless Guide',
        description: 'Complete guide to AWS Lambda functions',
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Frontend Guide',
        description: 'Building React applications',
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('lambda');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(targetContent.id);
    });

    it('should search by tags', async () => {
      const targetContent = await createTestContent(pool, testUserId, {
        title: 'Serverless Tutorial',
        tags: ['aws', 'lambda', 'serverless'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Frontend Tutorial',
        tags: ['react', 'javascript'],
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('lambda');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(targetContent.id);
    });

    it('should be case-insensitive', async () => {
      const targetContent = await createTestContent(pool, testUserId, {
        title: 'AWS Lambda Guide',
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('LAMBDA');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(targetContent.id);
    });

    it('should apply visibility filtering', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Private Lambda Guide',
        visibility: 'private',
      });
      const publicContent = await createTestContent(pool, testUserId, {
        title: 'Public Lambda Guide',
        visibility: 'public',
      });

      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.searchContent('lambda', { viewerId: regularViewer.id });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicContent.id);
    });

    it('should filter by content type', async () => {
      const blogContent = await createTestContent(pool, testUserId, {
        title: 'Lambda Blog',
        contentType: 'blog',
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Lambda Video',
        contentType: 'youtube',
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('lambda', {
        filters: { contentTypes: [ContentType.BLOG] },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(blogContent.id);
    });

    it('should filter by tags', async () => {
      const awsContent = await createTestContent(pool, testUserId, {
        title: 'AWS Guide',
        tags: ['aws', 'cloud'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Frontend Guide',
        tags: ['react', 'frontend'],
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('guide', {
        filters: { tags: ['aws'] },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(awsContent.id);
    });

    it('should filter by date range', async () => {
      const oldContent = await createTestContent(pool, testUserId, {
        title: 'Old Lambda Guide',
        publishDate: new Date('2020-01-01'),
        visibility: 'public',
      });
      const newContent = await createTestContent(pool, testUserId, {
        title: 'New Lambda Guide',
        publishDate: new Date('2024-01-01'),
        visibility: 'public',
      });

      const results = await contentRepository.searchContent('lambda', {
        filters: {
          dateRange: {
            start: new Date('2023-01-01'),
            end: new Date('2025-01-01'),
          },
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(newContent.id);
    });
  });

  describe('findRecentContent', () => {
    it('should find content from the last N days', async () => {
      // Create old content
      await pool.query(`
        INSERT INTO content (user_id, title, content_type, visibility, created_at)
        VALUES ($1, 'Old Content', 'blog', 'public', NOW() - INTERVAL '40 days')
      `, [testUserId]);

      // Create recent content
      const recentContent = await createTestContent(pool, testUserId, {
        title: 'Recent Content',
        visibility: 'public',
      });

      const results = await contentRepository.findRecentContent(30);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(recentContent.id);
    });

    it('should apply visibility filtering', async () => {
      const publicContent = await createTestContent(pool, testUserId, {
        title: 'Recent Public Content',
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Recent Private Content',
        visibility: 'private',
      });

      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.findRecentContent(30, { viewerId: regularViewer.id });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicContent.id);
    });
  });

  describe('findTrendingContent', () => {
    it('should find content ordered by engagement metrics', async () => {
      const content1 = await createTestContent(pool, testUserId, {
        title: 'Low Engagement Content',
        visibility: 'public',
      });
      const content2 = await createTestContent(pool, testUserId, {
        title: 'High Engagement Content',
        visibility: 'public',
      });

      // Add analytics data
      await pool.query(`
        INSERT INTO content_analytics (content_id, views_count, likes_count, engagement_score)
        VALUES ($1, 10, 5, 1.5), ($2, 100, 50, 8.7)
      `, [content1.id, content2.id]);

      const results = await contentRepository.findTrendingContent();

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(content2.id); // Higher engagement first
      expect(results[1].id).toBe(content1.id);
    });

    it('should apply visibility filtering', async () => {
      const privateContent = await createTestContent(pool, testUserId, {
        title: 'Private High Engagement',
        visibility: 'private',
      });
      const publicContent = await createTestContent(pool, testUserId, {
        title: 'Public Low Engagement',
        visibility: 'public',
      });

      // Add high engagement to private content
      await pool.query(`
        INSERT INTO content_analytics (content_id, engagement_score)
        VALUES ($1, 10.0), ($2, 5.0)
      `, [privateContent.id, publicContent.id]);

      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.findTrendingContent({ viewerId: regularViewer.id });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicContent.id);
    });
  });

  describe('findByTags', () => {
    it('should find content with any of the specified tags', async () => {
      const awsContent = await createTestContent(pool, testUserId, {
        tags: ['aws', 'cloud'],
        visibility: 'public',
      });
      const reactContent = await createTestContent(pool, testUserId, {
        tags: ['react', 'frontend'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        tags: ['python', 'backend'],
        visibility: 'public',
      });

      const results = await contentRepository.findByTags(['aws', 'react']);

      expect(results).toHaveLength(2);
      expect(results.map(c => c.id)).toContain(awsContent.id);
      expect(results.map(c => c.id)).toContain(reactContent.id);
    });

    it('should apply visibility filtering', async () => {
      await createTestContent(pool, testUserId, {
        tags: ['aws'],
        visibility: 'private',
      });
      const publicContent = await createTestContent(pool, testUserId, {
        tags: ['aws'],
        visibility: 'public',
      });

      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const results = await contentRepository.findByTags(['aws'], { viewerId: regularViewer.id });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(publicContent.id);
    });
  });

  describe('getContentStats', () => {
    it('should return content statistics', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Stats Test Content',
        visibility: 'public',
      });

      // Add analytics data
      await pool.query(`
        INSERT INTO content_analytics (content_id, views_count, likes_count, shares_count, comments_count, engagement_score)
        VALUES ($1, 150, 25, 10, 5, 7.5)
      `, [content.id]);

      const stats = await contentRepository.getContentStats(content.id);

      expect(stats).toMatchObject({
        contentId: content.id,
        viewsCount: 150,
        likesCount: 25,
        sharesCount: 10,
        commentsCount: 5,
        engagementScore: 7.5,
      });
    });

    it('should return null for non-existent content', async () => {
      const stats = await contentRepository.getContentStats('00000000-0000-0000-0000-000000000000');

      expect(stats).toBeNull();
    });
  });

  describe('updateContentStats', () => {
    it('should update content analytics', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'Update Stats Content',
        visibility: 'public',
      });

      const updated = await contentRepository.updateContentStats(content.id, {
        viewsCount: 100,
        likesCount: 20,
        sharesCount: 5,
      });

      expect(updated).toBe(true);

      const stats = await contentRepository.getContentStats(content.id);
      expect(stats).toMatchObject({
        viewsCount: 100,
        likesCount: 20,
        sharesCount: 5,
      });
    });

    it('should return false for non-existent content', async () => {
      const updated = await contentRepository.updateContentStats('00000000-0000-0000-0000-000000000000', {
        viewsCount: 100,
      });

      expect(updated).toBe(false);
    });
  });

  describe('claiming and discovery helpers', () => {
    it('should return unclaimed content and allow claiming', async () => {
      const unclaimed = await createTestContent(pool, testUserId, {
        title: 'Needs Owner',
        isClaimed: false,
      });
      const alreadyClaimed = await createTestContent(pool, testUserId, {
        title: 'Owned Content',
        isClaimed: true,
      });

      const unclaimedResults = await contentRepository.findUnclaimedContent();
      expect(unclaimedResults.map(c => c.id)).toContain(unclaimed.id);
      expect(unclaimedResults.map(c => c.id)).not.toContain(alreadyClaimed.id);

      const claimer = await createTestUser(pool, { username: 'claimer' });
      const claimed = await contentRepository.claimContent(unclaimed.id, claimer.id);
      expect(claimed).not.toBeNull();
      expect(claimed?.userId).toBe(claimer.id);
      expect(claimed?.isClaimed).toBe(true);

      const bulkContent = await createTestContent(pool, testUserId, {
        title: 'Bulk Claim',
        isClaimed: false,
      });
      const results = await contentRepository.bulkClaimContent(
        [bulkContent.id, alreadyClaimed.id],
        claimer.id
      );

      const success = results.find(r => r.contentId === bulkContent.id);
      const failure = results.find(r => r.contentId === alreadyClaimed.id);
      expect(success?.success).toBe(true);
      expect(failure?.success).toBe(false);
      expect(failure?.error).toBe('Content not found or already claimed');
    });

    it('allows admin override to reclaim content', async () => {
      const originalOwner = await createTestUser(pool, { username: 'original-owner' });
      const newOwner = await createTestUser(pool, { username: 'new-owner' });
      const content = await createTestContent(pool, originalOwner.id, {
        title: 'Reassignable Content',
        isClaimed: true,
      });

      const overridden = await contentRepository.claimContent(content.id, newOwner.id, {
        force: true,
      });

      expect(overridden).not.toBeNull();
      expect(overridden?.userId).toBe(newOwner.id);
      expect(overridden?.isClaimed).toBe(true);

      const row = await pool.query('SELECT user_id, version FROM content WHERE id = $1', [
        content.id,
      ]);
      expect(row.rows[0].user_id).toBe(newOwner.id);
      expect(row.rows[0].version).toBeGreaterThanOrEqual((content.version ?? 1) + 1);
    });

    it('should find content by date range and similar tags', async () => {
      const earlyContent = await createTestContent(pool, testUserId, {
        title: 'Early Article',
        visibility: 'public',
      });
      const recentContent = await createTestContent(pool, testUserId, {
        title: 'Recent Article',
        visibility: 'public',
      });

      await pool.query('UPDATE content SET publish_date = $1 WHERE id = $2', [
        new Date('2020-01-01T00:00:00Z'),
        earlyContent.id,
      ]);
      await pool.query('UPDATE content SET publish_date = $1 WHERE id = $2', [
        new Date('2024-01-01T00:00:00Z'),
        recentContent.id,
      ]);

      const results = await contentRepository.findByDateRange(
        new Date('2023-01-01T00:00:00Z'),
        new Date('2024-12-31T23:59:59Z')
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(recentContent.id);

      const taggedPrimary = await createTestContent(pool, testUserId, {
        title: 'Lambda Primary',
        tags: ['aws', 'lambda', 'serverless'],
        visibility: 'public',
      });
      const similar = await createTestContent(pool, testUserId, {
        title: 'Lambda Companion',
        tags: ['lambda', 'tutorial'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Different Topic',
        tags: ['database'],
        visibility: 'public',
      });

      const similarResults = await contentRepository.findSimilarContent(taggedPrimary.id, 5);
      expect(similarResults.map(c => c.id)).toContain(similar.id);
      expect(similarResults.map(c => c.id)).not.toContain(taggedPrimary.id);

      const untaged = await createTestContent(pool, testUserId, {
        title: 'No Tags',
        tags: [],
        visibility: 'public',
      });
      const emptySimilar = await contentRepository.findSimilarContent(untaged.id);
      expect(emptySimilar).toEqual([]);
    });
  });

  describe('findDuplicates', () => {
    it('should detect title-based duplicates when scanning entire library', async () => {
      const first = await createTestContent(pool, testUserId, {
        title: 'AWS Lambda Deep Dive',
        tags: ['aws', 'lambda'],
        visibility: 'public',
      });
      const similarContent = await createTestContent(pool, testUserId, {
        title: 'AWS Lambda deep dive tutorial',
        tags: ['lambda'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Completely Different Topic',
        tags: ['other'],
        visibility: 'public',
      });

      const duplicates = await contentRepository.findDuplicates(testUserId, 0.5, ['title']);

      expect(duplicates).toHaveLength(1);
      expect([first.id, similarContent.id]).toContain(duplicates[0].content.id);
      expect(duplicates[0].matchedFields).toEqual(['title']);
      expect(duplicates[0].similarity).toBeGreaterThanOrEqual(0.5);
    });

    it('should detect duplicates for a specific content when matching on tags', async () => {
      const target = await createTestContent(pool, testUserId, {
        title: 'Serverless Architecture Overview',
        tags: ['serverless', 'aws', 'lambda'],
        visibility: 'public',
      });
      const tagMatch = await createTestContent(pool, testUserId, {
        title: 'Serverless Architecture Deep Dive',
        tags: ['aws', 'lambda'],
        visibility: 'public',
      });
      await createTestContent(pool, testUserId, {
        title: 'Frontend Guide',
        tags: ['react'],
        visibility: 'public',
      });

      const duplicates = await contentRepository.findDuplicates(target.user_id, 0.3, ['tags'], target.id);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].content.id).toBe(tagMatch.id);
      expect(duplicates[0].matchedFields).toEqual(['tags']);
      expect(duplicates[0].similarity).toBeGreaterThan(0);
    });

    it('should detect URL-based duplicates when URLs overlap', async () => {
      const url = 'https://example.com/shared-resource';
      const first = await createTestContent(pool, testUserId, {
        title: 'Original Post',
        tags: ['aws'],
        visibility: 'public',
      });
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [first.id, url]
      );

      const second = await createTestContent(pool, testUserId, {
        title: 'Cross-posted Article',
        tags: ['aws'],
        visibility: 'public',
      });
      await pool.query(
        'INSERT INTO content_urls (content_id, url) VALUES ($1, $2)',
        [second.id, url]
      );

      await createTestContent(pool, testUserId, {
        title: 'Different URL Article',
        tags: ['aws'],
        visibility: 'public',
      });

      const duplicates = await contentRepository.findDuplicates(testUserId, 0.1, ['urls']);

      expect(duplicates).toHaveLength(1);
      expect([first.id, second.id]).toContain(duplicates[0].content.id);
      expect(duplicates[0].matchedFields).toEqual(['urls']);
      expect(duplicates[0].similarity).toBeGreaterThan(0);
    });

    it('should return an empty array when only one piece of content exists', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Solo Article',
        visibility: 'public',
      });

      const duplicates = await contentRepository.findDuplicates(testUserId);

      expect(duplicates).toEqual([]);
    });

    it('should throw when a specific content ID does not exist', async () => {
      await createTestContent(pool, testUserId, { title: 'Existing Content A' });
      await createTestContent(pool, testUserId, { title: 'Existing Content B' });

      await expect(
        contentRepository.findDuplicates(
          testUserId,
          0.5,
          ['title'],
          '00000000-0000-0000-0000-000000000000'
        )
      ).rejects.toThrow('Content not found');
    });
  });

  describe('visibility filtering', () => {
    it('should show private content only to owner', async () => {
      const privateContent = await createTestContent(pool, testUserId, {
        title: 'Private Content',
        visibility: 'private',
      });

      // Owner can see it
      const ownerResults = await contentRepository.findByUserId(testUserId, { viewerId: testUserId });
      expect(ownerResults).toHaveLength(1);

      // Other users cannot see it
      const regularViewer = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const otherResults = await contentRepository.findByUserId(testUserId, { viewerId: regularViewer.id });
      expect(otherResults).toHaveLength(0);
    });

    it('should show aws_only content to AWS employees and admins', async () => {
      const awsOnlyContent = await createTestContent(pool, testUserId, {
        title: 'AWS Only Content',
        visibility: 'aws_only',
      });

      // AWS employee can see it
      const awsResults = await contentRepository.findByUserId(testUserId, { viewerId: awsEmployeeUserId });
      expect(awsResults).toHaveLength(1);

      // Admin can see it
      const adminResults = await contentRepository.findByUserId(testUserId, { viewerId: adminUserId });
      expect(adminResults).toHaveLength(1);

      // Regular user cannot see it
      const regularUser = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const regularResults = await contentRepository.findByUserId(testUserId, { viewerId: regularUser.id });
      expect(regularResults).toHaveLength(0);
    });

    it('should show aws_community content to AWS employees, admins, and community members', async () => {
      const awsCommunityContent = await createTestContent(pool, testUserId, {
        title: 'AWS Community Content',
        visibility: 'aws_community',
      });

      // AWS employee can see it
      const awsResults = await contentRepository.findByUserId(testUserId, { viewerId: awsEmployeeUserId });
      expect(awsResults).toHaveLength(1);

      // Admin can see it
      const adminResults = await contentRepository.findByUserId(testUserId, { viewerId: adminUserId });
      expect(adminResults).toHaveLength(1);

      // Community badge holder can see it
      const communityMember = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_type, is_active)
         VALUES ($1, $2, true)`,
        [communityMember.id, BadgeType.COMMUNITY_BUILDER]
      );
      const communityResults = await contentRepository.findByUserId(testUserId, { viewerId: communityMember.id });
      expect(communityResults).toHaveLength(1);

      // Regular user without badge cannot see it
      const regularUser = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const restrictedResults = await contentRepository.findByUserId(testUserId, { viewerId: regularUser.id });
      expect(restrictedResults).toHaveLength(0);
    });

    it('should show public content to everyone', async () => {
      const publicContent = await createTestContent(pool, testUserId, {
        title: 'Public Content',
        visibility: 'public',
      });

      // Create an anonymous (non-logged-in) user scenario
      const results = await contentRepository.findByUserId(testUserId, { viewerId: null });
      expect(results).toHaveLength(1);

      // Any logged-in user can see it
      const regularUser = await createTestUser(pool, { isAdmin: false, isAwsEmployee: false });
      const regularResults = await contentRepository.findByUserId(testUserId, { viewerId: regularUser.id });
      expect(regularResults).toHaveLength(1);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty search queries', async () => {
      await createTestContent(pool, testUserId, { visibility: 'public' });

      const results = await contentRepository.searchContent('');

      expect(results).toHaveLength(0);
    });

    it('should handle SQL injection attempts in search', async () => {
      await createTestContent(pool, testUserId, {
        title: 'Normal Content',
        visibility: 'public',
      });

      // This should not cause SQL errors or return unexpected results
      const results = await contentRepository.searchContent("'; DROP TABLE content; --");

      expect(results).toHaveLength(0);
    });

    it('should handle invalid date ranges', async () => {
      await createTestContent(pool, testUserId, { visibility: 'public' });

      const results = await contentRepository.searchContent('content', {
        filters: {
          dateRange: {
            start: new Date('2025-01-01'),
            end: new Date('2020-01-01'), // End before start
          },
        },
      });

      expect(results).toHaveLength(0);
    });

    it('should handle content with no analytics data', async () => {
      const content = await createTestContent(pool, testUserId, {
        title: 'No Analytics Content',
        visibility: 'public',
      });

      const stats = await contentRepository.getContentStats(content.id);

      expect(stats).toMatchObject({
        contentId: content.id,
        viewsCount: 0,
        likesCount: 0,
        sharesCount: 0,
        commentsCount: 0,
        engagementScore: 0,
      });
    });
  });
});
