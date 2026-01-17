import { NotificationService, NotificationServiceOptions } from '../../../src/backend/services/NotificationService';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

jest.mock('@aws-sdk/client-ses', () => {
  const actual = jest.requireActual('@aws-sdk/client-ses');
  const sendMock = jest.fn();
  return {
    ...actual,
    SESClient: jest.fn(() => ({ send: sendMock })),
    __sesSendMock: sendMock,
  };
});

const sesSendMock = (jest.requireMock('@aws-sdk/client-ses') as { __sesSendMock: jest.Mock }).__sesSendMock;
const { SESClient: MockSesClient } = jest.requireMock('@aws-sdk/client-ses') as { SESClient: jest.Mock };

describe('NotificationService', () => {
  const mockPool = () => ({ query: jest.fn() }) as any;

  beforeEach(() => {
    MockSesClient.mockImplementation(() => ({ send: sesSendMock }));
    sesSendMock.mockReset();
  });

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
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'notif-2' }] });

    const service = new NotificationService(pool, 'noreply@test.com');
    const result = await service.notifyAdminForReview('user-1', 'content-1', 'Needs review');

    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(3);
    const insertCalls = pool.query.mock.calls.filter(
      call => Array.isArray(call[1]) && call[1].includes('content.claim_review')
    );
    expect(insertCalls).toHaveLength(2);
    const recipients = insertCalls.map(call => call[1][0]);
    expect(recipients).toEqual(expect.arrayContaining(['admin-1', 'admin-2']));
    insertCalls.forEach(call => {
      expect(JSON.parse(call[1][4])).toMatchObject({ reason: 'Needs review' });
    });
  });

  it('returns false when admin notification fails', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'admin-1', email: 'admin1@example.com' }],
    });
    const error = new Error('failure');
    pool.query.mockRejectedValueOnce(error);

    const service = new NotificationService(pool);
    await expect(service.notifyAdminForReview('user-1', 'content-1', 'reason')).resolves.toBe(false);
  });

  it('sends badge and merge notifications', async () => {
    const pool = mockPool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'notif-2' }] });

    const service = new NotificationService(pool);

    await expect(service.notifyBadgeGranted('user-1', 'hero', 'great work')).resolves.toBe(true);
    await expect(service.notifyContentMerged('user-2', 'primary', 2)).resolves.toBe(true);

    expect(pool.query).toHaveBeenCalledTimes(2);
    const badgeCall = pool.query.mock.calls.find(call => Array.isArray(call[1]) && call[1].includes('badge.granted'));
    const mergeCall = pool.query.mock.calls.find(call => Array.isArray(call[1]) && call[1].includes('content.merged'));
    expect(badgeCall?.[1]).toEqual(expect.arrayContaining(['user-1', 'badge.granted']));
    expect(mergeCall?.[1]).toEqual(expect.arrayContaining(['user-2', 'content.merged']));
  });

  it('handles notification failures gracefully', async () => {
    const pool = mockPool();
    pool.query.mockRejectedValue(new Error('oops'));

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
    sesSendMock.mockResolvedValueOnce({});

    const options: NotificationServiceOptions = {
      fromEmail: 'noreply@test.com',
      sesClient: new SESClient({ region: 'us-east-1' }),
      sesRegion: 'us-east-1',
    };
    const service = new NotificationService(pool, options);

    const result = await service.sendEmail({
      to: 'recipient@example.com',
      subject: 'Test Email',
      body: 'Body',
    });

    expect(result).toBe(true);
    expect(sesSendMock).toHaveBeenCalledTimes(1);
    expect(sesSendMock.mock.calls[0][0]).toBeInstanceOf(SendEmailCommand);
  });

  it('gracefully skips email sends when SES is not configured', async () => {
    const pool = mockPool();
    const service = new NotificationService(pool);

    const result = await service.sendEmail({
      to: 'recipient@example.com',
      subject: 'Test Email',
      body: 'Body',
    });

    expect(result).toBe(false);
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it('bulk notifies recipients while continuing on failure', async () => {
    const pool = mockPool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'id-1' }] })
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce({ rows: [{ id: 'id-3' }] });
    const service = new NotificationService(pool);

    const count = await service.bulkNotify([
      { recipientId: 'a', type: 't', title: 'x', message: 'm' },
      { recipientId: 'b', type: 't', title: 'x', message: 'm' },
      { recipientId: 'c', type: 't', title: 'x', message: 'm' },
    ]);

    expect(count).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
