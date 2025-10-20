import { NotificationService } from '../../../src/backend/services/NotificationService';

describe('NotificationService', () => {
  const mockPool = () => ({ query: jest.fn() }) as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('notifies all admins for review', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'admin-1', email: 'admin1@example.com' },
        { id: 'admin-2', email: 'admin2@example.com' },
      ],
    });

    const notificationSpy = jest
      .spyOn(NotificationService.prototype as any, 'createNotification')
      .mockResolvedValue('notif-1');

    const service = new NotificationService(pool, 'noreply@test.com');
    const result = await service.notifyAdminForReview('user-1', 'content-1', 'Needs review');

    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(notificationSpy).toHaveBeenCalledTimes(2);
    expect(notificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'admin-1',
        type: 'content.claim_review',
        metadata: expect.objectContaining({ reason: 'Needs review' }),
      })
    );
  });

  it('returns false when admin notification fails', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'admin-1', email: 'admin1@example.com' }],
    });
    const error = new Error('failure');
    jest.spyOn(NotificationService.prototype as any, 'createNotification').mockRejectedValue(error);

    const service = new NotificationService(pool);
    await expect(service.notifyAdminForReview('user-1', 'content-1', 'reason')).resolves.toBe(false);
  });

  it('sends badge and merge notifications', async () => {
    const pool = mockPool();
    jest.spyOn(NotificationService.prototype as any, 'createNotification').mockResolvedValue('id');

    const service = new NotificationService(pool);

    await expect(service.notifyBadgeGranted('user-1', 'hero', 'great work')).resolves.toBe(true);
    await expect(service.notifyContentMerged('user-2', 'primary', 2)).resolves.toBe(true);

    expect((NotificationService.prototype as any).createNotification).toHaveBeenCalledTimes(2);
  });

  it('handles notification failures gracefully', async () => {
    const pool = mockPool();
    jest.spyOn(NotificationService.prototype as any, 'createNotification').mockRejectedValue(new Error('oops'));

    const service = new NotificationService(pool);
    await expect(service.notifyBadgeGranted('user-1', 'hero')).resolves.toBe(false);
    await expect(service.notifyContentMerged('user-1', 'primary', 3)).resolves.toBe(false);
  });

  it('sends welcome and password reset emails using sendEmail', async () => {
    const pool = mockPool();
    const service = new NotificationService(pool, 'noreply@test.com');
    const sendEmailSpy = jest.spyOn(service, 'sendEmail').mockResolvedValue(true);

    await service.sendWelcomeEmail('user-1', 'user@example.com', 'username');
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Welcome to AWS Community Content Hub',
      })
    );

    process.env.FRONTEND_URL = 'https://example.com';
    await service.sendPasswordResetEmail('user@example.com', 'token-123');
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Reset Your Password',
      })
    );
  });

  it('sends email using default implementation', async () => {
    const pool = mockPool();
    const service = new NotificationService(pool, 'noreply@test.com');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await service.sendEmail({
      to: 'recipient@example.com',
      subject: 'Test Email',
      body: 'Body',
    });

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith('Email would be sent:', {
      from: 'noreply@test.com',
      to: 'recipient@example.com',
      subject: 'Test Email',
    });
  });

  it('bulk notifies recipients while continuing on failure', async () => {
    const pool = mockPool();
    const service = new NotificationService(pool);
    const createSpy = jest
      .spyOn(NotificationService.prototype as any, 'createNotification')
      .mockResolvedValueOnce('id-1')
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce('id-3');

    const count = await service.bulkNotify([
      { recipientId: 'a', type: 't', title: 'x', message: 'm' },
      { recipientId: 'b', type: 't', title: 'x', message: 'm' },
      { recipientId: 'c', type: 't', title: 'x', message: 'm' },
    ]);

    expect(count).toBe(2);
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  it('retrieves admin users via pool query', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'admin', email: 'admin@example.com' }] });
    const service = new NotificationService(pool);

    const admins = await (service as any).getAdminUsers();
    expect(admins).toEqual([{ id: 'admin', email: 'admin@example.com' }]);
  });
});
