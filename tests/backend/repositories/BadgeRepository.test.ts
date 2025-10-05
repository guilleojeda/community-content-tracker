import { Pool } from 'pg';
import { BadgeRepository } from '../../../src/backend/repositories/BadgeRepository';
import { Badge, BadgeType } from '@aws-community-hub/shared';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser, createTestContent } from './test-setup';

describe('BadgeRepository', () => {
  let pool: Pool;
  let badgeRepository: BadgeRepository;
  let testUserId: string;
  let testUser2Id: string;
  let adminUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    badgeRepository = new BadgeRepository(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();

    // Create test users
    const testUser = await createTestUser(pool, {
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
    });
    testUserId = testUser.id;

    const testUser2 = await createTestUser(pool, {
      username: 'testuser2',
      email: 'test2@example.com',
      isAdmin: false,
    });
    testUser2Id = testUser2.id;

    const adminUser = await createTestUser(pool, {
      username: 'adminuser',
      email: 'admin@example.com',
      isAdmin: true,
    });
    adminUserId = adminUser.id;
  });

  describe('findByUserId', () => {
    it('should find all badges for a specific user', async () => {
      // Award multiple badges to user
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      // Award badge to different user
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const badges = await badgeRepository.findByUserId(testUserId);

      expect(badges).toHaveLength(2);
      expect(badges.map(b => b.badgeType)).toContain(BadgeType.COMMUNITY_BUILDER);
      expect(badges.map(b => b.badgeType)).toContain(BadgeType.HERO);
      expect(badges.every(b => b.userId === testUserId)).toBe(true);
    });

    it('should return empty array for user with no badges', async () => {
      const badges = await badgeRepository.findByUserId(testUserId);

      expect(badges).toHaveLength(0);
    });

    it('should order badges by awarded_at DESC by default', async () => {
      // Award first badge
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Award second badge
      const badge2 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const badges = await badgeRepository.findByUserId(testUserId);

      expect(badges).toHaveLength(2);
      // Most recent first
      expect(badges[0].id).toBe(badge2.id);
      expect(badges[1].id).toBe(badge1.id);
    });

    it('should apply limit and offset options', async () => {
      // Award multiple different badges (can't award same badge type multiple times due to UNIQUE constraint)
      const badgeTypes = [BadgeType.COMMUNITY_BUILDER, BadgeType.HERO, BadgeType.AMBASSADOR, BadgeType.USER_GROUP_LEADER];

      for (let i = 0; i < badgeTypes.length; i++) {
        await pool.query(`
          INSERT INTO user_badges (user_id, badge_type, awarded_by)
          VALUES ($1, $2, $3)
        `, [testUserId, badgeTypes[i], adminUserId]);

        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const limitedBadges = await badgeRepository.findByUserId(testUserId, { limit: 2 });
      expect(limitedBadges).toHaveLength(2);

      const offsetBadges = await badgeRepository.findByUserId(testUserId, { limit: 2, offset: 2 });
      expect(offsetBadges).toHaveLength(2);
    });
  });

  describe('findByBadgeType', () => {
    it('should find all badges of a specific type', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const communityBuilders = await badgeRepository.findByBadgeType(BadgeType.COMMUNITY_BUILDER);
      const heroes = await badgeRepository.findByBadgeType(BadgeType.HERO);

      expect(communityBuilders).toHaveLength(2);
      expect(communityBuilders.every(b => b.badgeType === BadgeType.COMMUNITY_BUILDER)).toBe(true);
      expect(heroes).toHaveLength(1);
      expect(heroes[0].badgeType).toBe(BadgeType.HERO);
    });

    it('should return empty array for badge type with no awards', async () => {
      const badges = await badgeRepository.findByBadgeType(BadgeType.HERO);

      expect(badges).toHaveLength(0);
    });

    it('should order by awarded_at DESC by default', async () => {
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const badge2 = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const badges = await badgeRepository.findByBadgeType(BadgeType.HERO);

      expect(badges[0].id).toBe(badge2.id);
      expect(badges[1].id).toBe(badge1.id);
    });
  });

  describe('userHasBadge', () => {
    it('should return true when user has the badge type', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const hasBadge = await badgeRepository.userHasBadge(testUserId, BadgeType.COMMUNITY_BUILDER);

      expect(hasBadge).toBe(true);
    });

    it('should return false when user does not have the badge type', async () => {
      const hasBadge = await badgeRepository.userHasBadge(testUserId, BadgeType.COMMUNITY_BUILDER);

      expect(hasBadge).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      const hasBadge = await badgeRepository.userHasBadge(
        '00000000-0000-0000-0000-000000000000',
        BadgeType.COMMUNITY_BUILDER
      );

      expect(hasBadge).toBe(false);
    });
  });

  describe('awardBadge', () => {
    it('should successfully award a badge to a user', async () => {
      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Created 10+ pieces of content',
      });

      expect(badge).toMatchObject({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Created 10+ pieces of content',
      });
      expect(badge.id).toBeDefined();
      expect(badge.awardedAt).toBeInstanceOf(Date);
      expect(badge.createdAt).toBeInstanceOf(Date);
      expect(badge.updatedAt).toBeInstanceOf(Date);
    });

    it('should set awardedAt timestamp automatically', async () => {
      const beforeAward = new Date();

      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const afterAward = new Date();

      expect(badge.awardedAt.getTime()).toBeGreaterThanOrEqual(beforeAward.getTime());
      expect(badge.awardedAt.getTime()).toBeLessThanOrEqual(afterAward.getTime());
    });

    it('should throw error when awarding duplicate badge type to same user', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      await expect(
        badgeRepository.awardBadge({
          userId: testUserId,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          awardedBy: adminUserId,
        })
      ).rejects.toThrow('User already has badge type: community_builder');
    });

    it('should allow same badge type for different users', async () => {
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const badge2 = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      expect(badge1.userId).toBe(testUserId);
      expect(badge2.userId).toBe(testUser2Id);
      expect(badge1.badgeType).toBe(badge2.badgeType);
    });

    it('should allow awarding without awardedBy or awardedReason', async () => {
      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
      });

      expect(badge).toMatchObject({
        userId: testUserId,
        badgeType: BadgeType.HERO,
      });
      expect(badge.awardedBy).toBeUndefined();
      expect(badge.awardedReason).toBeUndefined();
    });
  });

  describe('revokeBadge', () => {
    it('should successfully revoke a badge from a user', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const revoked = await badgeRepository.revokeBadge(testUserId, BadgeType.COMMUNITY_BUILDER);

      expect(revoked).toBe(true);

      const hasBadge = await badgeRepository.userHasBadge(testUserId, BadgeType.COMMUNITY_BUILDER);
      expect(hasBadge).toBe(false);
    });

    it('should return false when revoking non-existent badge', async () => {
      const revoked = await badgeRepository.revokeBadge(testUserId, BadgeType.COMMUNITY_BUILDER);

      expect(revoked).toBe(false);
    });

    it('should only revoke badge for specified user', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      await badgeRepository.revokeBadge(testUserId, BadgeType.HERO);

      const user1HasBadge = await badgeRepository.userHasBadge(testUserId, BadgeType.HERO);
      const user2HasBadge = await badgeRepository.userHasBadge(testUser2Id, BadgeType.HERO);

      expect(user1HasBadge).toBe(false);
      expect(user2HasBadge).toBe(true);
    });
  });

  describe('findBadgeWithUser', () => {
    it('should return badge with user information', async () => {
      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Test reason',
      });

      const badgeWithUser = await badgeRepository.findBadgeWithUser(badge.id);

      expect(badgeWithUser).toMatchObject({
        id: badge.id,
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedReason: 'Test reason',
      });
      expect(badgeWithUser?.user).toMatchObject({
        id: testUserId,
        email: 'test@example.com',
        username: 'testuser',
      });
    });

    it('should return null for non-existent badge', async () => {
      const badgeWithUser = await badgeRepository.findBadgeWithUser('00000000-0000-0000-0000-000000000000');

      expect(badgeWithUser).toBeNull();
    });
  });

  describe('findBadgesAwardedBy', () => {
    it('should find all badges awarded by a specific admin', async () => {
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      const badge2 = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      // Award badge by different admin
      const anotherAdmin = await createTestUser(pool, {
        username: 'admin2',
        isAdmin: true,
      });
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: anotherAdmin.id,
      });

      const badges = await badgeRepository.findBadgesAwardedBy(adminUserId);

      expect(badges).toHaveLength(2);
      expect(badges.map(b => b.id)).toContain(badge1.id);
      expect(badges.map(b => b.id)).toContain(badge2.id);
      expect(badges.every(b => b.awardedBy === adminUserId)).toBe(true);
    });

    it('should return empty array for admin who has not awarded badges', async () => {
      const badges = await badgeRepository.findBadgesAwardedBy(adminUserId);

      expect(badges).toHaveLength(0);
    });

    it('should order by awarded_at DESC by default', async () => {
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const badge2 = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const badges = await badgeRepository.findBadgesAwardedBy(adminUserId);

      expect(badges[0].id).toBe(badge2.id);
      expect(badges[1].id).toBe(badge1.id);
    });
  });

  describe('getBadgeStatistics', () => {
    it('should return statistics for all badge types', async () => {
      // Create more users for percentage calculations
      const user3 = await createTestUser(pool, { username: 'user3' });
      const user4 = await createTestUser(pool, { username: 'user4' });

      // Award badges
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: user3.id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const stats = await badgeRepository.getBadgeStatistics();

      expect(stats).toHaveLength(2);

      const communityBuilderStats = stats.find(s => s.badgeType === BadgeType.COMMUNITY_BUILDER);
      expect(communityBuilderStats).toMatchObject({
        badgeType: BadgeType.COMMUNITY_BUILDER,
        count: 2,
      });
      expect(communityBuilderStats?.percentage).toBeGreaterThan(0);
      expect(communityBuilderStats?.lastAwarded).toBeInstanceOf(Date);

      const heroStats = stats.find(s => s.badgeType === BadgeType.HERO);
      expect(heroStats).toMatchObject({
        badgeType: BadgeType.HERO,
        count: 1,
      });
    });

    it('should return empty array when no badges are awarded', async () => {
      const stats = await badgeRepository.getBadgeStatistics();

      expect(stats).toHaveLength(0);
    });

    it('should order by count DESC', async () => {
      const user3 = await createTestUser(pool, { username: 'user3' });

      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: user3.id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const stats = await badgeRepository.getBadgeStatistics();

      // COMMUNITY_BUILDER (count: 2) should come before HERO (count: 1)
      expect(stats[0].badgeType).toBe(BadgeType.COMMUNITY_BUILDER);
      expect(stats[0].count).toBe(2);
      expect(stats[1].badgeType).toBe(BadgeType.HERO);
      expect(stats[1].count).toBe(1);
    });
  });

  describe('getUsersWithBadge', () => {
    it('should return all users with a specific badge type', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Reason 1',
      });
      await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Reason 2',
      });
      await badgeRepository.awardBadge({
        userId: adminUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const users = await badgeRepository.getUsersWithBadge(BadgeType.COMMUNITY_BUILDER);

      expect(users).toHaveLength(2);
      expect(users.map(u => u.id)).toContain(testUserId);
      expect(users.map(u => u.id)).toContain(testUser2Id);
      expect(users[0]).toHaveProperty('awardedAt');
      expect(users[0]).toHaveProperty('awardedReason');
    });

    it('should return empty array for badge type with no awards', async () => {
      const users = await badgeRepository.getUsersWithBadge(BadgeType.HERO);

      expect(users).toHaveLength(0);
    });

    it('should order by awarded_at DESC by default', async () => {
      const badge1 = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const badge2 = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const users = await badgeRepository.getUsersWithBadge(BadgeType.HERO);

      // Most recent first
      expect(users[0].id).toBe(testUser2Id);
      expect(users[1].id).toBe(testUserId);
    });

    it('should apply limit and offset options', async () => {
      const user3 = await createTestUser(pool, { username: 'user3' });
      const user4 = await createTestUser(pool, { username: 'user4' });
      const user5 = await createTestUser(pool, { username: 'user5' });

      await badgeRepository.awardBadge({ userId: testUserId, badgeType: BadgeType.HERO, awardedBy: adminUserId });
      await badgeRepository.awardBadge({ userId: testUser2Id, badgeType: BadgeType.HERO, awardedBy: adminUserId });
      await badgeRepository.awardBadge({ userId: user3.id, badgeType: BadgeType.HERO, awardedBy: adminUserId });
      await badgeRepository.awardBadge({ userId: user4.id, badgeType: BadgeType.HERO, awardedBy: adminUserId });
      await badgeRepository.awardBadge({ userId: user5.id, badgeType: BadgeType.HERO, awardedBy: adminUserId });

      const limitedUsers = await badgeRepository.getUsersWithBadge(BadgeType.HERO, { limit: 3 });
      expect(limitedUsers).toHaveLength(3);

      const offsetUsers = await badgeRepository.getUsersWithBadge(BadgeType.HERO, { limit: 2, offset: 2 });
      expect(offsetUsers).toHaveLength(2);
    });
  });

  describe('getRecentBadges', () => {
    it('should return badges from the last N days', async () => {
      // Create an old badge
      await pool.query(`
        INSERT INTO user_badges (user_id, badge_type, awarded_by, awarded_at)
        VALUES ($1, $2, $3, NOW() - INTERVAL '40 days')
      `, [testUserId, BadgeType.HERO, adminUserId]);

      // Create a recent badge
      const recentBadge = await badgeRepository.awardBadge({
        userId: testUser2Id,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      const badges = await badgeRepository.getRecentBadges(30);

      expect(badges).toHaveLength(1);
      expect(badges[0].id).toBe(recentBadge.id);
    });

    it('should apply limit and offset options', async () => {
      // Create multiple recent badges with different types (UNIQUE constraint prevents duplicates)
      const badgeTypes = [BadgeType.COMMUNITY_BUILDER, BadgeType.HERO, BadgeType.AMBASSADOR, BadgeType.USER_GROUP_LEADER];

      for (let i = 0; i < badgeTypes.length; i++) {
        await pool.query(`
          INSERT INTO user_badges (user_id, badge_type, awarded_by, awarded_at)
          VALUES ($1, $2, $3, NOW())
        `, [testUserId, badgeTypes[i], adminUserId]);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const limitedBadges = await badgeRepository.getRecentBadges(30, { limit: 2 });
      expect(limitedBadges).toHaveLength(2);

      const offsetBadges = await badgeRepository.getRecentBadges(30, { limit: 2, offset: 2 });
      expect(offsetBadges).toHaveLength(2);
    });

    it('should return empty array when no recent badges', async () => {
      // Create an old badge
      await pool.query(`
        INSERT INTO user_badges (user_id, badge_type, awarded_by, awarded_at)
        VALUES ($1, $2, $3, NOW() - INTERVAL '100 days')
      `, [testUserId, BadgeType.HERO, adminUserId]);

      const badges = await badgeRepository.getRecentBadges(30);

      expect(badges).toHaveLength(0);
    });
  });

  describe('awardMultipleBadges', () => {
    it('should award multiple badges in a transaction', async () => {
      const badgesData = [
        {
          userId: testUserId,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          awardedBy: adminUserId,
        },
        {
          userId: testUserId,
          badgeType: BadgeType.HERO,
          awardedBy: adminUserId,
        },
        {
          userId: testUser2Id,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          awardedBy: adminUserId,
        },
      ];

      const badges = await badgeRepository.awardMultipleBadges(badgesData);

      expect(badges).toHaveLength(3);
      expect(badges.every(b => b.id)).toBe(true);
      expect(badges.every(b => b.awardedAt)).toBe(true);
    });

    it('should skip duplicate badges during bulk award', async () => {
      // Award one badge first
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      // Try to award it again along with new badges
      const badgesData = [
        {
          userId: testUserId,
          badgeType: BadgeType.COMMUNITY_BUILDER, // Duplicate
          awardedBy: adminUserId,
        },
        {
          userId: testUserId,
          badgeType: BadgeType.HERO, // New
          awardedBy: adminUserId,
        },
      ];

      const badges = await badgeRepository.awardMultipleBadges(badgesData);

      // Should only award the new badge
      expect(badges).toHaveLength(1);
      expect(badges[0].badgeType).toBe(BadgeType.HERO);
    });

    it('should rollback transaction on error', async () => {
      const badgesData = [
        {
          userId: testUserId,
          badgeType: BadgeType.COMMUNITY_BUILDER,
          awardedBy: adminUserId,
        },
        {
          userId: 'invalid-user-id', // This should cause an error
          badgeType: BadgeType.HERO,
          awardedBy: adminUserId,
        },
      ];

      await expect(badgeRepository.awardMultipleBadges(badgesData)).rejects.toThrow();

      // Verify no badges were awarded
      const userBadges = await badgeRepository.findByUserId(testUserId);
      expect(userBadges).toHaveLength(0);
    });

    it('should return empty array for empty input', async () => {
      const badges = await badgeRepository.awardMultipleBadges([]);

      expect(badges).toHaveLength(0);
    });
  });

  describe('getUserBadgeCount', () => {
    it('should return correct badge count for user', async () => {
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
      });

      const count = await badgeRepository.getUserBadgeCount(testUserId);

      expect(count).toBe(2);
    });

    it('should return 0 for user with no badges', async () => {
      const count = await badgeRepository.getUserBadgeCount(testUserId);

      expect(count).toBe(0);
    });

    it('should return 0 for non-existent user', async () => {
      const count = await badgeRepository.getUserBadgeCount('00000000-0000-0000-0000-000000000000');

      expect(count).toBe(0);
    });
  });

  describe('checkCommunityBuilderEligibility', () => {
    it('should return true when user has 10+ claimed content', async () => {
      // Create 10 pieces of content for the user
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      const eligible = await badgeRepository.checkCommunityBuilderEligibility(testUserId);

      expect(eligible).toBe(true);
    });

    it('should return false when user has less than 10 claimed content', async () => {
      // Create 5 pieces of content
      for (let i = 0; i < 5; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      const eligible = await badgeRepository.checkCommunityBuilderEligibility(testUserId);

      expect(eligible).toBe(false);
    });

    it('should not count unclaimed content', async () => {
      // Create 10 pieces of unclaimed content
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: false,
        });
      }

      const eligible = await badgeRepository.checkCommunityBuilderEligibility(testUserId);

      expect(eligible).toBe(false);
    });

    it('should return false for user with no content', async () => {
      const eligible = await badgeRepository.checkCommunityBuilderEligibility(testUserId);

      expect(eligible).toBe(false);
    });
  });

  describe('checkHeroEligibility', () => {
    it('should return true when user has 100+ total views', async () => {
      const content1 = await createTestContent(pool, testUserId, { title: 'Content 1' });
      const content2 = await createTestContent(pool, testUserId, { title: 'Content 2' });

      // Add views to content
      await pool.query(`
        UPDATE content
        SET metrics = jsonb_build_object('views', 60)
        WHERE id = $1
      `, [content1.id]);

      await pool.query(`
        UPDATE content
        SET metrics = jsonb_build_object('views', 50)
        WHERE id = $1
      `, [content2.id]);

      const eligible = await badgeRepository.checkHeroEligibility(testUserId);

      expect(eligible).toBe(true);
    });

    it('should return false when user has less than 100 total views', async () => {
      const content = await createTestContent(pool, testUserId, { title: 'Content 1' });

      await pool.query(`
        UPDATE content
        SET metrics = jsonb_build_object('views', 50)
        WHERE id = $1
      `, [content.id]);

      const eligible = await badgeRepository.checkHeroEligibility(testUserId);

      expect(eligible).toBe(false);
    });

    it('should return false when user has no content', async () => {
      const eligible = await badgeRepository.checkHeroEligibility(testUserId);

      expect(eligible).toBe(false);
    });

    it('should handle content with no metrics', async () => {
      await createTestContent(pool, testUserId, { title: 'Content 1' });

      const eligible = await badgeRepository.checkHeroEligibility(testUserId);

      expect(eligible).toBe(false);
    });
  });

  describe('autoAwardBadges', () => {
    it('should auto-award Community Builder badge when eligible', async () => {
      // Create 10 pieces of content
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId, adminUserId);

      expect(awardedBadges).toHaveLength(1);
      expect(awardedBadges[0]).toMatchObject({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
        awardedReason: 'Created 10+ pieces of content',
      });
    });

    it('should auto-award Hero badge when eligible', async () => {
      const content = await createTestContent(pool, testUserId, { title: 'Popular Content' });

      await pool.query(`
        UPDATE content
        SET metrics = jsonb_build_object('views', 100)
        WHERE id = $1
      `, [content.id]);

      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId, adminUserId);

      expect(awardedBadges).toHaveLength(1);
      expect(awardedBadges[0]).toMatchObject({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
        awardedReason: 'Achieved 100+ content views',
      });
    });

    it('should auto-award multiple badges when eligible', async () => {
      // Make eligible for Community Builder
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      // Make eligible for Hero by setting views
      const contentIds = await pool.query(`
        SELECT id FROM content WHERE user_id = $1 LIMIT 2
      `, [testUserId]);

      for (const row of contentIds.rows) {
        await pool.query(`
          UPDATE content
          SET metrics = jsonb_build_object('views', 60)
          WHERE id = $1
        `, [row.id]);
      }

      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId, adminUserId);

      expect(awardedBadges).toHaveLength(2);
      expect(awardedBadges.map(b => b.badgeType)).toContain(BadgeType.COMMUNITY_BUILDER);
      expect(awardedBadges.map(b => b.badgeType)).toContain(BadgeType.HERO);
    });

    it('should not award badges user already has', async () => {
      // Create content to be eligible
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      // Award badge manually first
      await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
        awardedBy: adminUserId,
      });

      // Try to auto-award
      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId, adminUserId);

      expect(awardedBadges).toHaveLength(0);
    });

    it('should return empty array when user is not eligible for any badges', async () => {
      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId, adminUserId);

      expect(awardedBadges).toHaveLength(0);
    });

    it('should allow auto-award without awardedBy parameter', async () => {
      // Create content to be eligible
      for (let i = 0; i < 10; i++) {
        await createTestContent(pool, testUserId, {
          title: `Content ${i}`,
          isClaimed: true,
        });
      }

      const awardedBadges = await badgeRepository.autoAwardBadges(testUserId);

      expect(awardedBadges).toHaveLength(1);
      expect(awardedBadges[0].badgeType).toBe(BadgeType.COMMUNITY_BUILDER);
      expect(awardedBadges[0].awardedBy).toBeUndefined();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle SQL injection attempts in userHasBadge', async () => {
      // Parameterized queries prevent SQL injection - invalid UUID throws error
      await expect(
        badgeRepository.userHasBadge(
          "'; DROP TABLE user_badges; --",
          BadgeType.COMMUNITY_BUILDER
        )
      ).rejects.toThrow();
    });

    it('should handle invalid UUID formats gracefully', async () => {
      // Invalid UUID format throws error with parameterized queries
      await expect(
        badgeRepository.getUserBadgeCount('not-a-uuid')
      ).rejects.toThrow();
    });

    it('should handle concurrent badge awards to same user', async () => {
      // Attempt to award the same badge type concurrently
      const promises = [
        badgeRepository.awardBadge({
          userId: testUserId,
          badgeType: BadgeType.HERO,
          awardedBy: adminUserId,
        }),
        badgeRepository.awardBadge({
          userId: testUserId,
          badgeType: BadgeType.HERO,
          awardedBy: adminUserId,
        }),
      ];

      // One should succeed, one should fail
      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify only one badge exists
      const badges = await badgeRepository.findByUserId(testUserId);
      expect(badges).toHaveLength(1);
    });

    it('should handle badges with all optional fields', async () => {
      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.COMMUNITY_BUILDER,
      });

      expect(badge.userId).toBe(testUserId);
      expect(badge.badgeType).toBe(BadgeType.COMMUNITY_BUILDER);
      expect(badge.awardedBy).toBeUndefined();
      expect(badge.awardedReason).toBeUndefined();
      expect(badge.awardedAt).toBeInstanceOf(Date);
    });

    it('should handle very long awardedReason text', async () => {
      const longReason = 'A'.repeat(1000);

      const badge = await badgeRepository.awardBadge({
        userId: testUserId,
        badgeType: BadgeType.HERO,
        awardedBy: adminUserId,
        awardedReason: longReason,
      });

      expect(badge.awardedReason).toBe(longReason);
    });
  });
});