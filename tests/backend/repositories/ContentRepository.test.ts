import { Pool } from 'pg';
import { ContentRepository } from '../../../src/backend/repositories/ContentRepository';
import { Content, ContentType, Visibility } from '@aws-community-hub/shared';
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
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

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
      const results = await contentRepository.findByUserId(testUserId, { viewerId: adminUserId });

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

      const results = await contentRepository.findByContentType(ContentType.BLOG, {
        viewerId: adminUserId,
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

      const results = await contentRepository.searchContent('lambda', { viewerId: adminUserId });

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

      const results = await contentRepository.findRecentContent(30, { viewerId: adminUserId });

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

      const results = await contentRepository.findTrendingContent({ viewerId: adminUserId });

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

      const results = await contentRepository.findByTags(['aws'], { viewerId: adminUserId });

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
      const otherResults = await contentRepository.findByUserId(testUserId, { viewerId: adminUserId });
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

      // TODO: Add test for community members when badge system is implemented
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