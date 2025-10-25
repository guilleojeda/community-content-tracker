import { Pool } from 'pg';
import { UserRepository } from '../../../src/backend/repositories/UserRepository';
import { User, Visibility } from '@aws-community-hub/shared';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from './test-setup';

describe('UserRepository', () => {
  let pool: Pool;
  let userRepository: UserRepository;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    userRepository = new UserRepository(pool);
    await pool.query(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false`);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  describe('findByCognitoSub', () => {
    it('should find user by Cognito sub', async () => {
      const user = await createTestUser(pool, {
        cognitoSub: 'cognito-sub-12345',
        email: 'cognito@example.com',
        username: 'cognitouser',
      });

      const result = await userRepository.findByCognitoSub('cognito-sub-12345');

      expect(result).toMatchObject({
        id: user.id,
        cognitoSub: 'cognito-sub-12345',
        email: 'cognito@example.com',
        username: 'cognitouser',
      });
    });

    it('should return null for non-existent Cognito sub', async () => {
      const result = await userRepository.findByCognitoSub('non-existent-sub');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      const user = await createTestUser(pool, {
        email: 'email-test@example.com',
        username: 'emailuser',
      });

      const result = await userRepository.findByEmail('email-test@example.com');

      expect(result).toMatchObject({
        id: user.id,
        email: 'email-test@example.com',
        username: 'emailuser',
      });
    });

    it('should return null for non-existent email', async () => {
      const result = await userRepository.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should be case-insensitive for email search', async () => {
      await createTestUser(pool, {
        email: 'case@example.com',
        username: 'caseuser',
      });

      const result = await userRepository.findByEmail('CASE@EXAMPLE.COM');

      expect(result).toMatchObject({
        email: 'case@example.com',
        username: 'caseuser',
      });
    });
  });

  describe('findByUsername', () => {
    it('should find user by username', async () => {
      const user = await createTestUser(pool, {
        username: 'uniqueuser',
        email: 'unique@example.com',
      });

      const result = await userRepository.findByUsername('uniqueuser');

      expect(result).toMatchObject({
        id: user.id,
        username: 'uniqueuser',
        email: 'unique@example.com',
      });
    });

    it('should return null for non-existent username', async () => {
      const result = await userRepository.findByUsername('nonexistentuser');

      expect(result).toBeNull();
    });

    it('should be case-sensitive for username search', async () => {
      await createTestUser(pool, {
        username: 'CaseSensitive',
        email: 'case@example.com',
      });

      const result = await userRepository.findByUsername('casesensitive');

      expect(result).toBeNull();
    });
  });

  describe('findByProfileSlug', () => {
    it('should find user by profile slug', async () => {
      const user = await createTestUser(pool, {
        profileSlug: 'unique-profile-slug',
        username: 'sluguser',
      });

      const result = await userRepository.findByProfileSlug('unique-profile-slug');

      expect(result).toMatchObject({
        id: user.id,
        profileSlug: 'unique-profile-slug',
        username: 'sluguser',
      });
    });

    it('should return null for non-existent profile slug', async () => {
      const result = await userRepository.findByProfileSlug('non-existent-slug');

      expect(result).toBeNull();
    });
  });

  describe('isAdmin', () => {
    it('should return true for admin users', async () => {
      const adminUser = await createTestUser(pool, {
        isAdmin: true,
        username: 'adminuser',
      });

      const isAdmin = await userRepository.isAdmin(adminUser.id);

      expect(isAdmin).toBe(true);
    });

    it('should return false for non-admin users', async () => {
      const regularUser = await createTestUser(pool, {
        isAdmin: false,
        username: 'regularuser',
      });

      const isAdmin = await userRepository.isAdmin(regularUser.id);

      expect(isAdmin).toBe(false);
    });

    it('should return false for non-existent users', async () => {
      const isAdmin = await userRepository.isAdmin('00000000-0000-0000-0000-000000000000');

      expect(isAdmin).toBe(false);
    });
  });

  describe('findAdmins', () => {
    it('should return all admin users', async () => {
      const admin1 = await createTestUser(pool, {
        isAdmin: true,
        username: 'admin1',
      });
      const admin2 = await createTestUser(pool, {
        isAdmin: true,
        username: 'admin2',
      });
      await createTestUser(pool, {
        isAdmin: false,
        username: 'regular',
      });

      const admins = await userRepository.findAdmins();

      expect(admins).toHaveLength(2);
      expect(admins.map(a => a.id)).toContain(admin1.id);
      expect(admins.map(a => a.id)).toContain(admin2.id);
      expect(admins.every(a => a.isAdmin)).toBe(true);
    });

    it('should return empty array when no admins exist', async () => {
      await createTestUser(pool, { isAdmin: false });

      const admins = await userRepository.findAdmins();

      expect(admins).toHaveLength(0);
    });
  });

  describe('findAwsEmployees', () => {
    it('should return all AWS employees', async () => {
      const employee1 = await createTestUser(pool, {
        isAwsEmployee: true,
        username: 'awsemployee1',
      });
      const employee2 = await createTestUser(pool, {
        isAwsEmployee: true,
        username: 'awsemployee2',
      });
      await createTestUser(pool, {
        isAwsEmployee: false,
        username: 'external',
      });

      const employees = await userRepository.findAwsEmployees();

      expect(employees).toHaveLength(2);
      expect(employees.map(e => e.id)).toContain(employee1.id);
      expect(employees.map(e => e.id)).toContain(employee2.id);
      expect(employees.every(e => e.isAwsEmployee)).toBe(true);
    });

    it('should return empty array when no AWS employees exist', async () => {
      await createTestUser(pool, { isAwsEmployee: false });

      const employees = await userRepository.findAwsEmployees();

      expect(employees).toHaveLength(0);
    });
  });

  describe('updateDefaultVisibility', () => {
    it('should update user default visibility', async () => {
      const user = await createTestUser(pool, {
        defaultVisibility: 'private',
        username: 'visibilityuser',
      });

      const result = await userRepository.updateDefaultVisibility(user.id, Visibility.PUBLIC);

      expect(result).toMatchObject({
        id: user.id,
        defaultVisibility: 'public',
        username: 'visibilityuser',
      });
    });

    it('should return null for non-existent user', async () => {
      const result = await userRepository.updateDefaultVisibility(
        '00000000-0000-0000-0000-000000000000',
        Visibility.PUBLIC
      );

      expect(result).toBeNull();
    });
  });

  describe('searchUsers', () => {
    it('should search users by username containing query', async () => {
      await createTestUser(pool, { username: 'johndoe' });
      await createTestUser(pool, { username: 'johndoe123' });
      await createTestUser(pool, { username: 'janesmith' });
      await createTestUser(pool, { username: 'alicebrown' });

      const results = await userRepository.searchUsers('john');

      expect(results).toHaveLength(2);
      expect(results.map(u => u.username)).toContain('johndoe');
      expect(results.map(u => u.username)).toContain('johndoe123');
    });

    it('should search users by email containing query', async () => {
      await createTestUser(pool, {
        username: 'user1',
        email: 'john.doe@example.com'
      });
      await createTestUser(pool, {
        username: 'user2',
        email: 'johndoe@company.com'
      });
      await createTestUser(pool, {
        username: 'user3',
        email: 'jane@example.com'
      });

      const results = await userRepository.searchUsers('john');

      expect(results).toHaveLength(2);
      expect(results.map(u => u.email)).toContain('john.doe@example.com');
      expect(results.map(u => u.email)).toContain('johndoe@company.com');
    });

    it('should apply limit to search results', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestUser(pool, { username: `searchuser${i}` });
      }

      const results = await userRepository.searchUsers('searchuser', { limit: 3 });

      expect(results).toHaveLength(3);
    });

    it('should return empty array for no matches', async () => {
      await createTestUser(pool, { username: 'nomatch' });

      const results = await userRepository.searchUsers('xyz123');

      expect(results).toHaveLength(0);
    });

    it('should be case-insensitive', async () => {
      await createTestUser(pool, { username: 'CaseTest' });

      const results = await userRepository.searchUsers('casetest');

      expect(results).toHaveLength(1);
      expect(results[0].username).toBe('CaseTest');
    });
  });

  describe('getUserProfile', () => {
    it('should return complete user profile', async () => {
      const user = await createTestUser(pool, {
        username: 'profileuser',
        email: 'profile@example.com',
        isAdmin: true,
        isAwsEmployee: true,
      });

      const profile = await userRepository.getUserProfile(user.id);

      expect(profile).toMatchObject({
        id: user.id,
        username: 'profileuser',
        email: 'profile@example.com',
        isAdmin: true,
        isAwsEmployee: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should return null for non-existent user', async () => {
      const profile = await userRepository.getUserProfile('00000000-0000-0000-0000-000000000000');

      expect(profile).toBeNull();
    });
  });

  describe('validateUniqueFields', () => {
    it('should return validation errors for duplicate email', async () => {
      await createTestUser(pool, {
        email: 'duplicate@example.com',
        username: 'original',
        profileSlug: 'original-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'duplicate@example.com',
        username: 'different',
        profileSlug: 'different-slug',
      });

      expect(errors).toEqual({
        email: 'Email already exists',
      });
    });

    it('should return validation errors for duplicate username', async () => {
      await createTestUser(pool, {
        email: 'original@example.com',
        username: 'duplicate',
        profileSlug: 'original-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'different@example.com',
        username: 'duplicate',
        profileSlug: 'different-slug',
      });

      expect(errors).toEqual({
        username: 'Username already exists',
      });
    });

    it('should return validation errors for duplicate profile slug', async () => {
      await createTestUser(pool, {
        email: 'original@example.com',
        username: 'original',
        profileSlug: 'duplicate-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'different@example.com',
        username: 'different',
        profileSlug: 'duplicate-slug',
      });

      expect(errors).toEqual({
        profileSlug: 'Profile slug already exists',
      });
    });

    it('should return multiple validation errors', async () => {
      await createTestUser(pool, {
        email: 'duplicate@example.com',
        username: 'duplicate',
        profileSlug: 'duplicate-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'duplicate@example.com',
        username: 'duplicate',
        profileSlug: 'duplicate-slug',
      });

      expect(errors).toEqual({
        email: 'Email already exists',
        username: 'Username already exists',
        profileSlug: 'Profile slug already exists',
      });
    });

    it('should return empty object for valid unique fields', async () => {
      await createTestUser(pool, {
        email: 'existing@example.com',
        username: 'existing',
        profileSlug: 'existing-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'new@example.com',
        username: 'newuser',
        profileSlug: 'new-slug',
      });

      expect(errors).toEqual({});
    });

    it('should exclude current user when validating for updates', async () => {
      const user = await createTestUser(pool, {
        email: 'user@example.com',
        username: 'user',
        profileSlug: 'user-slug',
      });

      const errors = await userRepository.validateUniqueFields({
        email: 'user@example.com',
        username: 'user',
        profileSlug: 'user-slug',
      }, user.id);

      expect(errors).toEqual({});
    });
  });

  describe('updateUser', () => {
    it('should persist social links and return them', async () => {
      const user = await createTestUser(pool);

      const updated = await userRepository.updateUser(user.id, {
        socialLinks: {
          twitter: 'https://twitter.com/rectified',
          website: 'https://example.com',
        },
      });

      expect(updated).not.toBeNull();
      expect(updated?.socialLinks).toEqual({
        twitter: 'https://twitter.com/rectified',
        website: 'https://example.com',
      });
    });
  });

  describe('GDPR compliance', () => {
    it('should export user data in JSON format', async () => {
      const user = await createTestUser(pool, {
        username: 'gdpruser',
        email: 'gdpr@example.com',
      });

      const exportData = await userRepository.exportUserData(user.id);

      expect(exportData).toHaveProperty('user');
      expect(exportData).toHaveProperty('content');
      expect(exportData).toHaveProperty('badges');
      expect(exportData).toHaveProperty('channels');
      expect(exportData).toHaveProperty('bookmarks');
      expect(exportData).toHaveProperty('follows');
      expect(exportData).toHaveProperty('consents');
      expect(exportData).toHaveProperty('export_date');

      expect(exportData.user).toMatchObject({
        id: user.id,
        username: 'gdpruser',
        email: 'gdpr@example.com',
      });
    });

    it('should delete user data completely', async () => {
      const user = await createTestUser(pool, {
        username: 'deleteuser',
        email: 'delete@example.com',
      });

      const deleted = await userRepository.deleteUserData(user.id);

      expect(deleted).toBe(true);

      // Verify user is deleted
      const found = await userRepository.findById(user.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent user', async () => {
      const deleted = await userRepository.deleteUserData('00000000-0000-0000-0000-000000000000');

      expect(deleted).toBe(false);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle SQL injection attempts in search', async () => {
      await createTestUser(pool, { username: 'normaluser' });

      // This should not cause SQL errors or return unexpected results
      const results = await userRepository.searchUsers("'; DROP TABLE users; --");

      expect(results).toHaveLength(0);
    });

    it('should handle empty search queries', async () => {
      await createTestUser(pool, { username: 'user1' });
      await createTestUser(pool, { username: 'user2' });

      const results = await userRepository.searchUsers('');

      expect(results).toHaveLength(0);
    });

    it('should handle special characters in search', async () => {
      await createTestUser(pool, { username: 'user@123' });

      const results = await userRepository.searchUsers('@');

      expect(results).toHaveLength(1);
      expect(results[0].username).toBe('user@123');
    });
  });
});
