import { createRequire } from 'module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
// 🔥 Force CommonJS load (this is REQUIRED)
const Brevo = require('@getbrevo/brevo');

interface EmailOptions {
  to: string | string[];
  subject: string;
  htmlContent?: string;
  textContent?: string;
  templateId?: number;
  params?: Record<string, any>;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{
    name: string;
    content: Buffer | string;
  }>;
}

interface EmailTemplate {
  welcome?: number;
  passwordReset?: number;
  subscriptionExpiring?: number;
  subscriptionRenewed?: number;
  usageAlert?: number;
  campaignComplete?: number;
  dailyReport?: number;
}

class EmailService {
  // ⚠️ DO NOT TYPE THIS WITH BREVO TYPES
  private apiInstance: any;
  private defaultFrom: { email: string; name: string };
  private templates: EmailTemplate;


  constructor() {
    if (!process.env.BREVO_API_KEY) {
      logger.warn('⚠️ BREVO_API_KEY not set');
      throw new Error('BREVO_API_KEY is required');
    }

    // ✅ Proper Brevo v1.x initialization (2024+ pattern)
    this.apiInstance = new Brevo.TransactionalEmailsApi(
      new Brevo.Configuration({
        apiKey: {
          'api-key': process.env.BREVO_API_KEY // Direct config
        }
      })
    );

    this.defaultFrom = {
      email: process.env.BREVO_SENDER_EMAIL || 'noreply@salez.online',
      name: process.env.BREVO_SENDER_NAME || 'Salez CRM',
    };

    // Initialize templates (was missing)
    this.templates = {};
  }


  /**
   * Send a transactional email
   */
  async sendEmail(options: EmailOptions) {
    try {
      // ✅ PLAIN OBJECT (this is the fix)
      const email: any = {
        sender: this.defaultFrom,
        subject: options.subject,
        to: Array.isArray(options.to)
          ? options.to.map(email => ({ email }))
          : [{ email: options.to }],
      };

      if (options.templateId) {
        email.templateId = options.templateId;
        email.params = options.params || {};
      } else {
        email.htmlContent = options.htmlContent;
        email.textContent = options.textContent;
      }

      if (options.cc) email.cc = options.cc.map(email => ({ email }));
      if (options.bcc) email.bcc = options.bcc.map(email => ({ email }));
      if (options.replyTo) email.replyTo = { email: options.replyTo };

      if (options.attachments) {
        email.attachment = options.attachments.map(att => ({
          name: att.name,
          content: Buffer.isBuffer(att.content)
            ? att.content.toString('base64')
            : att.content,
        }));
      }

      const result = await this.apiInstance.sendTransacEmail(email);

      logger.info('✉️ Email sent', { messageId: result?.messageId });

      return { success: true, messageId: result?.messageId };
    } catch (err: any) {
      logger.error('❌ Email send failed', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(userEmail: string, userName: string, businessName: string): Promise<void> {
    if (this.templates.welcome) {
      await this.sendEmail({
        to: userEmail,
        subject: `Welcome to ${businessName}!`,
        templateId: this.templates.welcome,
        params: {
          userName,
          businessName
        }
      });
    } else {
      await this.sendEmail({
        to: userEmail,
        subject: `Welcome to ${businessName}!`,
        htmlContent: `
          <h1>Welcome, ${userName}!</h1>
          <p>Thank you for joining ${businessName}. We're excited to have you on board!</p>
          <p>Get started by setting up your WhatsApp account and creating your first campaign.</p>
        `
      });
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(userEmail: string, resetToken: string, userName: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    if (this.templates.passwordReset) {
      await this.sendEmail({
        to: userEmail,
        subject: 'Reset Your Password',
        templateId: this.templates.passwordReset,
        params: {
          userName,
          resetUrl
        }
      });
    } else {
      await this.sendEmail({
        to: userEmail,
        subject: 'Reset Your Password',
        htmlContent: `
          <h1>Password Reset Request</h1>
          <p>Hi ${userName},</p>
          <p>You requested to reset your password. Click the link below to reset it:</p>
          <p><a href="${resetUrl}">Reset Password</a></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      });
    }
  }

  /**
   * Send subscription expiring notification
   */
  async sendSubscriptionExpiringEmail(
    userEmail: string,
    userName: string,
    planName: string,
    daysRemaining: number
  ): Promise<void> {
    await this.sendEmail({
      to: userEmail,
      subject: `Your ${planName} Subscription Expires Soon`,
      templateId: this.templates.subscriptionExpiring || undefined,
      params: {
        userName,
        planName,
        daysRemaining
      },
      htmlContent: !this.templates.subscriptionExpiring ? `
        <h1>Subscription Expiring Soon</h1>
        <p>Hi ${userName},</p>
        <p>Your ${planName} subscription will expire in ${daysRemaining} days.</p>
        <p>Renew now to continue enjoying uninterrupted service.</p>
        <p><a href="${process.env.FRONTEND_URL}/billing">Manage Subscription</a></p>
      ` : undefined
    });
  }

  /**
   * Send subscription renewed confirmation
   */
  async sendSubscriptionRenewedEmail(
    userEmail: string,
    userName: string,
    planName: string,
    renewalDate: Date
  ): Promise<void> {
    await this.sendEmail({
      to: userEmail,
      subject: 'Subscription Renewed Successfully',
      templateId: this.templates.subscriptionRenewed || undefined,
      params: {
        userName,
        planName,
        renewalDate: renewalDate.toLocaleDateString()
      },
      htmlContent: !this.templates.subscriptionRenewed ? `
        <h1>Subscription Renewed</h1>
        <p>Hi ${userName},</p>
        <p>Your ${planName} subscription has been successfully renewed.</p>
        <p>Next renewal date: ${renewalDate.toLocaleDateString()}</p>
        <p>Thank you for your continued business!</p>
      ` : undefined
    });
  }

  /**
   * Send usage alert email
   */
  async sendUsageAlertEmail(
    userEmail: string,
    userName: string,
    usagePercent: number,
    limit: number,
    used: number
  ): Promise<void> {
    await this.sendEmail({
      to: userEmail,
      subject: `⚠️ You've Used ${usagePercent}% of Your Plan Limit`,
      templateId: this.templates.usageAlert || undefined,
      params: {
        userName,
        usagePercent,
        limit,
        used
      },
      htmlContent: !this.templates.usageAlert ? `
        <h1>Usage Alert</h1>
        <p>Hi ${userName},</p>
        <p>You've used ${used} out of ${limit} conversations (${usagePercent}% of your plan limit).</p>
        <p>Consider upgrading your plan to continue uninterrupted service.</p>
        <p><a href="${process.env.FRONTEND_URL}/billing">Upgrade Plan</a></p>
      ` : undefined
    });
  }

  /**
   * Send campaign completion notification
   */
  async sendCampaignCompleteEmail(
    userEmail: string,
    userName: string,
    campaignName: string,
    stats: { sent: number; delivered: number; replied: number }
  ): Promise<void> {
    await this.sendEmail({
      to: userEmail,
      subject: `Campaign "${campaignName}" Completed`,
      templateId: this.templates.campaignComplete || undefined,
      params: {
        userName,
        campaignName,
        ...stats
      },
      htmlContent: !this.templates.campaignComplete ? `
        <h1>Campaign Completed</h1>
        <p>Hi ${userName},</p>
        <p>Your campaign "<strong>${campaignName}</strong>" has completed!</p>
        <h3>Results:</h3>
        <ul>
          <li>Messages Sent: ${stats.sent}</li>
          <li>Delivered: ${stats.delivered}</li>
          <li>Replies: ${stats.replied}</li>
        </ul>
        <p><a href="${process.env.FRONTEND_URL}/campaigns">View Campaign Details</a></p>
      ` : undefined
    });
  }

  /**
   * Send daily report email
   */
  async sendDailyReportEmail(
    userEmail: string,
    userName: string,
    reportData: {
      newContacts: number;
      messagesReceived: number;
      messagesSent: number;
      conversions: number;
    }
  ): Promise<void> {
    await this.sendEmail({
      to: userEmail,
      subject: `Daily Report - ${new Date().toLocaleDateString()}`,
      templateId: this.templates.dailyReport || undefined,
      params: {
        userName,
        date: new Date().toLocaleDateString(),
        ...reportData
      },
      htmlContent: !this.templates.dailyReport ? `
        <h1>Daily Activity Report</h1>
        <p>Hi ${userName},</p>
        <p>Here's your activity summary for ${new Date().toLocaleDateString()}:</p>
        <ul>
          <li>New Contacts: ${reportData.newContacts}</li>
          <li>Messages Received: ${reportData.messagesReceived}</li>
          <li>Messages Sent: ${reportData.messagesSent}</li>
          <li>Conversions: ${reportData.conversions}</li>
        </ul>
        <p><a href="${process.env.FRONTEND_URL}/analytics">View Full Analytics</a></p>
      ` : undefined
    });
  }

  /**
   * Send bulk emails (for campaigns)
   */
  async sendBulkEmail(emails: EmailOptions[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const emailOptions of emails) {
      const result = await this.sendEmail(emailOptions);
      if (result.success) {
        success++;
      } else {
        failed++;
      }
      
      // Rate limiting - wait 100ms between emails
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`📧 Bulk email sent: ${success} succeeded, ${failed} failed`);
    
    return { success, failed };
  }
}

export const emailService = new EmailService();
export default emailService;