import { Pool } from 'pg';
import { BaseRepository } from '../../../src/backend/repositories/BaseRepository';
import { setupTestDatabase, teardownTestDatabase, resetTestData, createTestUser } from './test-setup';

// Test implementation of BaseRepository
class TestUserRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool, 'users');
  }

  // Override for testing specific transformations
  protected transformRow(row: any): any {
    return {
      ...row,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cognitoSub: row.cognito_sub,
      profileSlug: row.profile_slug,
      defaultVisibility: row.default_visibility,
      isAdmin: row.is_admin,
      isAwsEmployee: row.is_aws_employee,
    };
  }

  protected transformData(data: any): any {
    const transformed: any = {};
    // Only map the fields we need, converting camelCase to snake_case
    if (data.id) transformed.id = data.id;
    if (data.cognitoSub) transformed.cognito_sub = data.cognitoSub;
    if (data.email) transformed.email = data.email;
    if (data.username) transformed.username = data.username;
    if (data.profileSlug) transformed.profile_slug = data.profileSlug;
    if (data.defaultVisibility) transformed.default_visibility = data.defaultVisibility;
    if (data.isAdmin !== undefined) transformed.is_admin = data.isAdmin;
    if (data.isAwsEmployee !== undefined) transformed.is_aws_employee = data.isAwsEmployee;
    if (data.createdAt) transformed.created_at = data.createdAt;
    if (data.updatedAt) transformed.updated_at = data.updatedAt;
    return transformed;
  }
}

describe('BaseRepository', () => {
  let pool: Pool;
  let repository: TestUserRepository;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    repository = new TestUserRepository(pool);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  describe('create', () => {
    it('should create a new record and return it', async () => {
      const userData = {
        cognitoSub: 'test-cognito-sub-123',
        email: 'test@example.com',
        username: 'testuser',
        profileSlug: 'test-user',
        defaultVisibility: 'private',
        isAdmin: false,
        isAwsEmployee: false,
      };

      const result = await repository.create(userData);

      expect(result).toMatchObject({
        id: expect.any(String),
        cognitoSub: userData.cognitoSub,
        email: userData.email,
        username: userData.username,
        profileSlug: userData.profileSlug,
        defaultVisibility: userData.defaultVisibility,
        isAdmin: userData.isAdmin,
        isAwsEmployee: userData.isAwsEmployee,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should throw error on duplicate unique constraints', async () => {
      const userData = {
        cognitoSub: 'test-cognito-sub-456',
        email: 'duplicate@example.com',
        username: 'duplicateuser',
        profileSlug: 'duplicate-user',
        defaultVisibility: 'private',
        isAdmin: false,
        isAwsEmployee: false,
      };

      await repository.create(userData);

      await expect(repository.create(userData)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should find and return a record by ID', async () => {
      const user = await createTestUser(pool);

      const result = await repository.findById(user.id);

      expect(result).toMatchObject({
        id: user.id,
        email: user.email,
        username: user.username,
      });
    });

    it('should return null for non-existent ID', async () => {
      const result = await repository.findById('00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });

    it('should throw error for invalid UUID format', async () => {
      await expect(repository.findById('invalid-id')).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return all records when no options provided', async () => {
      await createTestUser(pool);
      await createTestUser(pool);
      await createTestUser(pool);

      const results = await repository.findAll();

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('email');
    });

    it('should apply limit correctly', async () => {
      await createTestUser(pool);
      await createTestUser(pool);
      await createTestUser(pool);

      const results = await repository.findAll({ limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should apply offset correctly', async () => {
      const users = [];
      for (let i = 0; i < 3; i++) {
        users.push(await createTestUser(pool));
      }

      const results = await repository.findAll({ limit: 2, offset: 1 });

      expect(results).toHaveLength(2);
      expect(results[0].id).not.toBe(users[0].id);
    });

    it('should apply orderBy correctly', async () => {
      const user1 = await createTestUser(pool, { username: 'auser' });
      const user2 = await createTestUser(pool, { username: 'zuser' });

      const resultsAsc = await repository.findAll({
        orderBy: 'username',
        orderDirection: 'ASC',
      });

      expect(resultsAsc[0].username).toBe('auser');
      expect(resultsAsc[1].username).toBe('zuser');

      const resultsDesc = await repository.findAll({
        orderBy: 'username',
        orderDirection: 'DESC',
      });

      expect(resultsDesc[0].username).toBe('zuser');
      expect(resultsDesc[1].username).toBe('auser');
    });
  });

  describe('update', () => {
    it('should update a record and return the updated data', async () => {
      const user = await createTestUser(pool);
      const updateData = {
        email: 'updated@example.com',
        isAdmin: true,
      };

      const result = await repository.update(user.id, updateData);

      expect(result).toMatchObject({
        id: user.id,
        email: updateData.email,
        isAdmin: updateData.isAdmin,
        username: user.username, // unchanged
        updatedAt: expect.any(Date),
      });

      // Verify the updated_at timestamp changed
      expect(result.updatedAt.getTime()).toBeGreaterThan(user.updated_at.getTime());
    });

    it('should return null for non-existent ID', async () => {
      const result = await repository.update('00000000-0000-0000-0000-000000000000', {
        email: 'nonexistent@example.com',
      });

      expect(result).toBeNull();
    });

    it('should throw error on constraint violations', async () => {
      const user1 = await createTestUser(pool);
      const user2 = await createTestUser(pool);

      await expect(
        repository.update(user2.id, { email: user1.email })
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete a record and return true', async () => {
      const user = await createTestUser(pool);

      const result = await repository.delete(user.id);

      expect(result).toBe(true);

      // Verify the record is deleted
      const found = await repository.findById(user.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const result = await repository.delete('00000000-0000-0000-0000-000000000000');

      expect(result).toBe(false);
    });
  });

  describe('findBy', () => {
    it('should find records by field conditions', async () => {
      const adminUser = await createTestUser(pool, { isAdmin: true });
      const regularUser = await createTestUser(pool, { isAdmin: false });

      const adminUsers = await repository.findBy({ is_admin: true });

      expect(adminUsers).toHaveLength(1);
      expect(adminUsers[0].id).toBe(adminUser.id);
    });

    it('should return empty array when no matches found', async () => {
      await createTestUser(pool, { isAdmin: false });

      const adminUsers = await repository.findBy({ is_admin: true });

      expect(adminUsers).toHaveLength(0);
    });

    it('should handle multiple conditions with AND logic', async () => {
      await createTestUser(pool, { isAdmin: true, isAwsEmployee: false });
      const target = await createTestUser(pool, { isAdmin: true, isAwsEmployee: true });
      await createTestUser(pool, { isAdmin: false, isAwsEmployee: true });

      const results = await repository.findBy({
        is_admin: true,
        is_aws_employee: true,
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(target.id);
    });
  });

  describe('count', () => {
    it('should return total count when no conditions provided', async () => {
      await createTestUser(pool);
      await createTestUser(pool);
      await createTestUser(pool);

      const count = await repository.count();

      expect(count).toBe(3);
    });

    it('should return count with conditions', async () => {
      await createTestUser(pool, { isAdmin: true });
      await createTestUser(pool, { isAdmin: true });
      await createTestUser(pool, { isAdmin: false });

      const adminCount = await repository.count({ is_admin: true });
      const totalCount = await repository.count();

      expect(adminCount).toBe(2);
      expect(totalCount).toBe(3);
    });
  });

  describe('exists', () => {
    it('should return true when record exists', async () => {
      const user = await createTestUser(pool);

      const exists = await repository.exists(user.id);

      expect(exists).toBe(true);
    });

    it('should return false when record does not exist', async () => {
      const exists = await repository.exists('00000000-0000-0000-0000-000000000000');

      expect(exists).toBe(false);
    });
  });

  describe('transaction support', () => {
    it('should support transactions for create operations', async () => {
      const userData1 = {
        cognitoSub: 'trans-test-1',
        email: 'trans1@example.com',
        username: 'transuser1',
        profileSlug: 'trans-user-1',
        defaultVisibility: 'private',
        isAdmin: false,
        isAwsEmployee: false,
      };

      const userData2 = {
        cognitoSub: 'trans-test-2',
        email: 'trans2@example.com',
        username: 'transuser2',
        profileSlug: 'trans-user-2',
        defaultVisibility: 'private',
        isAdmin: false,
        isAwsEmployee: false,
      };

      // This should work in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const repo1 = new TestUserRepository(client as any);
        const result1 = await repo1.create(userData1);
        const result2 = await repo1.create(userData2);

        await client.query('COMMIT');

        expect(result1).toHaveProperty('id');
        expect(result2).toHaveProperty('id');

        // Verify both records exist
        const found1 = await repository.findById(result1.id);
        const found2 = await repository.findById(result2.id);

        expect(found1).not.toBeNull();
        expect(found2).not.toBeNull();
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors gracefully', async () => {
      const disconnectedPool = new Pool({ connectionString: 'postgresql://invalid:invalid@localhost:9999/invalid' });
      const badRepo = new TestUserRepository(disconnectedPool);

      await expect(badRepo.findAll()).rejects.toThrow();

      await disconnectedPool.end();
    });

    it('should handle malformed SQL queries', async () => {
      // This tests the repository's resilience to SQL injection attempts
      await expect(
        repository.findBy({ "username'; DROP TABLE users; --": 'test' })
      ).rejects.toThrow();
    });
  });
});