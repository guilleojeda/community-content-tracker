import { Pool, PoolClient } from 'pg';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface NotificationData {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface EmailData {
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
  from?: string;
}

export interface NotificationServiceOptions {
  fromEmail?: string;
  sesRegion?: string;
  sesClient?: SESClient;
}

/**
 * Service for sending notifications and emails
 * Handles user notifications, admin alerts, and email delivery
 */
export class NotificationService {
  private readonly fromEmail?: string;
  private readonly sesClient?: SESClient;

  constructor(
    private pool: Pool | PoolClient,
    optionsOrFromEmail?: NotificationServiceOptions | string
  ) {
    if (typeof optionsOrFromEmail === 'string') {
      this.fromEmail = optionsOrFromEmail;
    } else if (optionsOrFromEmail?.fromEmail) {
      this.fromEmail = optionsOrFromEmail.fromEmail;
    } else {
      this.fromEmail =
        process.env.NOTIFICATION_EMAIL_FROM ||
        process.env.SES_EMAIL_SENDER ||
        process.env.SES_FROM_EMAIL;
    }

    if (typeof optionsOrFromEmail === 'object' && optionsOrFromEmail?.sesClient) {
      this.sesClient = optionsOrFromEmail.sesClient;
    } else {
      const region =
        (typeof optionsOrFromEmail === 'object' && optionsOrFromEmail?.sesRegion) ||
        process.env.SES_REGION ||
        process.env.AWS_REGION;

      if (this.fromEmail && region) {
        this.sesClient = new SESClient({ region });
      }
    }
  }

  /**
   * Send notification to admin for review
   * Used when users claim content and need verification
   */
  async notifyAdminForReview(
    userId: string,
    contentId: string,
    reason: string
  ): Promise<boolean> {
    try {
      // Get all admin users
      const admins = await this.getAdminUsers();

      // Create notification for each admin
      for (const admin of admins) {
        await this.createNotification({
          recipientId: admin.id,
          type: 'content.claim_review',
          title: 'Content Claim Requires Review',
          message: `User ${userId} has claimed content ${contentId}. Reason: ${reason}`,
          metadata: {
            userId,
            contentId,
            reason,
          },
          priority: 'medium',
        });
      }

      // In production, this would also send emails
      console.log(`Admin notification sent for content claim: ${contentId}`);

      return true;
    } catch (error) {
      console.error('Failed to notify admins:', error);
      // Non-critical failure, don't throw
      return false;
    }
  }

  /**
   * Send notification about badge grant
   */
  async notifyBadgeGranted(
    userId: string,
    badgeType: string,
    reason?: string
  ): Promise<boolean> {
    try {
      await this.createNotification({
        recipientId: userId,
        type: 'badge.granted',
        title: 'Badge Awarded!',
        message: `You have been awarded the ${badgeType} badge${reason ? `: ${reason}` : ''}`,
        metadata: {
          badgeType,
          reason,
        },
        priority: 'high',
      });

      return true;
    } catch (error) {
      console.error('Failed to send badge notification:', error);
      return false;
    }
  }

  /**
   * Send notification about content merge
   */
  async notifyContentMerged(
    userId: string,
    primaryContentId: string,
    mergedCount: number
  ): Promise<boolean> {
    try {
      await this.createNotification({
        recipientId: userId,
        type: 'content.merged',
        title: 'Content Merged',
        message: `${mergedCount} content items have been merged into one.`,
        metadata: {
          primaryContentId,
          mergedCount,
        },
        priority: 'low',
      });

      return true;
    } catch (error) {
      console.error('Failed to send merge notification:', error);
      return false;
    }
  }

  /**
   * Send email using Amazon SES (when configured)
   */
  async sendEmail(emailData: EmailData): Promise<boolean> {
    if (!this.sesClient || !this.fromEmail) {
      console.warn('Email service is not configured; skipping email send');
      return false;
    }

    try {
      const toAddresses = Array.isArray(emailData.to) ? emailData.to : [emailData.to];
      if (toAddresses.length === 0) {
        console.warn('No recipients specified for email');
        return false;
      }

      const command = new SendEmailCommand({
        Source: emailData.from || this.fromEmail,
        Destination: {
          ToAddresses: toAddresses,
        },
        Message: {
          Subject: { Data: emailData.subject, Charset: 'UTF-8' },
          Body: {
            Html: emailData.html ? { Data: emailData.html, Charset: 'UTF-8' } : undefined,
            Text: emailData.body ? { Data: emailData.body, Charset: 'UTF-8' } : undefined,
          },
        },
      });

      await this.sesClient.send(command);
      return true;
    } catch (error) {
      console.error('Failed to send email via SES:', error);
      return false;
    }
  }

  /**
   * Create a notification record
   */
  private async createNotification(data: NotificationData): Promise<string> {
    const query = `
      INSERT INTO notifications (user_id, type, title, message, metadata, priority)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING id
    `;

    const result = await this.pool.query(query, [
      data.recipientId,
      data.type,
      data.title,
      data.message,
      JSON.stringify(data.metadata ?? {}),
      data.priority ?? 'low',
    ]);

    return result.rows[0].id;
  }

  /**
   * Get all admin users
   */
  private async getAdminUsers(): Promise<Array<{ id: string; email: string }>> {
    const query = `
      SELECT id, email
      FROM users
      WHERE is_admin = true
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(userId: string, email: string, username: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Welcome to AWS Community Content Hub',
      body: `Welcome ${username}! Your account has been created successfully.`,
      html: `
        <h1>Welcome to AWS Community Content Hub!</h1>
        <p>Hi ${username},</p>
        <p>Your account has been created successfully. You can now start tracking your AWS community contributions.</p>
        <p>Happy contributing!</p>
      `,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    return this.sendEmail({
      to: email,
      subject: 'Reset Your Password',
      body: `Click the following link to reset your password: ${resetUrl}`,
      html: `
        <h1>Reset Your Password</h1>
        <p>Click the link below to reset your password:</p>
        <p><a href="${resetUrl}">Reset Password</a></p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });
  }

  /**
   * Bulk notify multiple users
   */
  async bulkNotify(notifications: NotificationData[]): Promise<number> {
    let successCount = 0;

    for (const notification of notifications) {
      try {
        await this.createNotification(notification);
        successCount++;
      } catch (error) {
        console.error('Failed to create notification:', error);
      }
    }

    return successCount;
  }
}
