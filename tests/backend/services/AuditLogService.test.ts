import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AuditLogService } from '../../../src/backend/services/AuditLogService';
import {
  setupTestDatabase,
  teardownTestDatabase,
  resetTestData,
  createTestUser,
} from '../repositories/test-setup';

describe('AuditLogService', () => {
  let pool: Pool;
  let service: AuditLogService;
  let testUserId: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    pool = setup.pool;
    service = new AuditLogService(pool);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        old_values JSONB,
        new_values JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await resetTestData();
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
    const user = await createTestUser(pool, { username: 'audited_user' });
    testUserId = user.id;
  });

  const fetchAuditRows = async () => {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC');
    return rows;
  };

  it('logs a generic audit entry', async () => {
    const resourceId = randomUUID();
    const entryId = await service.log({
      userId: testUserId,
      action: 'system.test',
      resourceType: 'test_resource',
      resourceId,
      oldValues: { before: 1 },
      newValues: { after: 2 },
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(entryId).toBeDefined();
    const [row] = await fetchAuditRows();
    expect(row.action).toBe('system.test');
    expect(row.resource_type).toBe('test_resource');
    expect(row.old_values).toMatchObject({ before: 1 });
    expect(row.new_values).toMatchObject({ after: 2 });
  });

  it('logs content lifecycle events', async () => {
    const content = { title: 'Example', visibility: 'public' };

    const contentId = randomUUID();
    const primaryId = randomUUID();
    const mergedIds = [randomUUID(), randomUUID()];

    await service.logContentCreate(testUserId, contentId, content);
    await service.logContentUpdate(testUserId, contentId, { title: 'Old' }, { title: 'New' });
    await service.logContentDelete(testUserId, contentId, content);
    await service.logContentClaim(testUserId, contentId);
    await service.logContentMerge(testUserId, primaryId, mergedIds);

    const rows = await fetchAuditRows();
    expect(rows).toHaveLength(5);
    const actions = rows.map(row => row.action).sort();
    expect(actions).toEqual([
      'content.merge',
      'content.claim',
      'content.delete',
      'content.update',
      'content.create',
    ].sort());
    const mergeEntry = rows.find(row => row.action === 'content.merge');
    expect(mergeEntry?.new_values).toMatchObject({
      primaryContentId: primaryId,
      mergedContentIds: mergedIds,
      mergedCount: 2,
    });
  });

  it('logs badge and AWS employee changes', async () => {
    const admin = await createTestUser(pool, { username: 'admin-user', isAdmin: true });

    await service.logBadgeGrant(admin.id, testUserId, 'community_builder', 'Great work');
    await service.logBadgeRevoke(admin.id, testUserId, 'community_builder', 'Policy change');
    await service.logAwsEmployeeChange(admin.id, testUserId, true, 'Verified', { region: 'us-east-1' });

    const rows = await fetchAuditRows();
    expect(rows).toHaveLength(3);

    const grant = rows.find(row => row.action === 'badge.grant');
    expect(grant?.new_values).toMatchObject({
      userId: testUserId,
      badgeType: 'community_builder',
      reason: 'Great work',
      grantedBy: admin.id,
    });

    const revoke = rows.find(row => row.action === 'badge.revoke');
    expect(revoke?.old_values).toMatchObject({ userId: testUserId, badgeType: 'community_builder' });

    const employeeChange = rows.find(row => row.action === 'user.aws_employee_change');
    expect(employeeChange?.new_values).toMatchObject({
      isAwsEmployee: true,
      changedBy: admin.id,
      reason: 'Verified',
      metadata: { region: 'us-east-1' },
    });
  });

  it('supports filtered queries and pagination', async () => {
    const otherUser = await createTestUser(pool, { username: 'second_user' });

    const contentResourceId = randomUUID();
    await service.log({
      userId: testUserId,
      action: 'content.create',
      resourceType: 'content',
      resourceId: contentResourceId,
    });
    await service.log({
      userId: otherUser.id,
      action: 'content.delete',
      resourceType: 'content',
      resourceId: contentResourceId,
    });
    await service.log({
      userId: testUserId,
      action: 'badge.grant',
      resourceType: 'user_badge',
      resourceId: otherUser.id,
    });

    const filteredByUser = await service.query({ userId: testUserId });
    expect(filteredByUser).toHaveLength(2);

    const filteredByAction = await service.query({ action: 'content.delete' });
    expect(filteredByAction).toHaveLength(1);

    const filteredByResource = await service.query({ resourceType: 'content', resourceId: contentResourceId });
    expect(filteredByResource).toHaveLength(2);

    const paged = await service.query({ limit: 1, offset: 0 });
    expect(paged).toHaveLength(1);
  });

  it('returns resource audit trails and user actions via query helper methods', async () => {
    const resourceAuditId = randomUUID();
    await service.log({
      userId: testUserId,
      action: 'content.update',
      resourceType: 'content',
      resourceId: resourceAuditId,
    });
    await service.log({
      userId: testUserId,
      action: 'content.delete',
      resourceType: 'content',
      resourceId: resourceAuditId,
    });

    const resourceTrail = await service.getResourceAuditTrail('content', resourceAuditId, 10);
    expect(resourceTrail).toHaveLength(2);

    const userActions = await service.getUserActions(testUserId, 5);
    expect(userActions).toHaveLength(2);
  });

  it('aggregates action statistics', async () => {
    await service.log({ userId: testUserId, action: 'content.update', resourceType: 'content' });
    await service.log({ userId: testUserId, action: 'content.update', resourceType: 'content' });
    await service.log({ userId: testUserId, action: 'content.create', resourceType: 'content' });

    const stats = await service.getActionStatistics();
    const updateStat = stats.find(stat => stat.action === 'content.update');
    const createStat = stats.find(stat => stat.action === 'content.create');

    expect(updateStat?.count).toBe(2);
    expect(createStat?.count).toBe(1);
  });
});
