import Stripe from 'stripe';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { emailService } from './email.service.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

interface SubscriptionData {
  businessId: number;
  planId: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

interface UsageData {
  businessId: number;
  conversationId: string;
  cost: number;
}

interface Invoice {
  id: number;
  businessId: number;
  amount: number;
  period: string;
  status: 'pending' | 'paid' | 'failed';
  pdfUrl?: string;
}

/**
 * Billing Service
 * Handles subscriptions, payments, usage tracking, and invoice generation
 */
class BillingService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2024-12-18.acacia',
    });
  }

  /**
   * Create a new subscription
   */
  async createSubscription(data: SubscriptionData): Promise<any> {
    try {
      // Get plan details
      const planResult = await pool.query(
        'SELECT * FROM plans WHERE id = $1',
        [data.planId]
      );

      if (planResult.rows.length === 0) {
        throw new AppError('Plan not found', 404);
      }

      const plan = planResult.rows[0];

      // Get business details
      const businessResult = await pool.query(
        'SELECT * FROM businesses WHERE id = $1',
        [data.businessId]
      );

      const business = businessResult.rows[0];

      // Create or get Stripe customer
      let customerId = data.stripeCustomerId;
      
      if (!customerId) {
        const customer = await this.stripe.customers.create({
          email: business.email,
          name: business.business_name,
          metadata: {
            businessId: data.businessId.toString()
          }
        });
        customerId = customer.id;
      }

      // Create Stripe subscription
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
            },
            recurring: {
              interval: 'month',
            },
            unit_amount: Math.round(parseFloat(plan.price) * 100), // Convert to cents
          },
        }],
        metadata: {
          businessId: data.businessId.toString(),
          planId: data.planId.toString()
        }
      });

      // Calculate renewal date (30 days from now)
      const renewsAt = new Date();
      renewsAt.setDate(renewsAt.getDate() + 30);

      // Save subscription to database
      const subscriptionResult = await pool.query(
        `INSERT INTO subscriptions (business_id, plan_id, renews_at, status, stripe_customer_id, stripe_subscription_id)
         VALUES ($1, $2, $3, 'active', $4, $5)
         RETURNING *`,
        [data.businessId, data.planId, renewsAt, customerId, stripeSubscription.id]
      );

      logger.info(`✅ Subscription created for business ${data.businessId}`);

      // Send confirmation email
      const userResult = await pool.query(
        'SELECT email, name FROM users WHERE business_id = $1 AND role = $2 LIMIT 1',
        [data.businessId, 'owner']
      );

      if (userResult.rows.length > 0) {
        await emailService.sendSubscriptionRenewedEmail(
          userResult.rows[0].email,
          userResult.rows[0].name,
          plan.name,
          renewsAt
        );
      }

      return subscriptionResult.rows[0];
    } catch (error: any) {
      logger.error('Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Get active subscription for a business
   */
  async getActiveSubscription(businessId: number): Promise<any> {
    const result = await pool.query(
      `SELECT s.*, p.name as plan_name, p.conversation_limit, p.price
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.business_id = $1 AND s.status = 'active'
       ORDER BY s.renews_at DESC
       LIMIT 1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      throw new AppError('No active subscription found', 404);
    }

    return result.rows[0];
  }

  /**
   * Track usage for a conversation
   */
  async trackUsage(data: UsageData): Promise<void> {
    await pool.query(
      `INSERT INTO usage_logs (business_id, conversation_id, cost)
       VALUES ($1, $2, $3)`,
      [data.businessId, data.conversationId, data.cost]
    );

    // Check usage limits
    await this.checkUsageLimits(data.businessId);
  }

  /**
   * Get usage statistics for a business
   */
  async getUsageStats(businessId: number, period: 'day' | 'month' | 'all' = 'month'): Promise<any> {
    let timeFilter = '';
    
    switch (period) {
      case 'day':
        timeFilter = "AND timestamp >= NOW() - INTERVAL '1 day'";
        break;
      case 'month':
        timeFilter = "AND timestamp >= NOW() - INTERVAL '1 month'";
        break;
    }

    const result = await pool.query(
      `SELECT 
         COUNT(DISTINCT conversation_id) as total_conversations,
         SUM(cost) as total_cost,
         MIN(timestamp) as period_start,
         MAX(timestamp) as period_end
       FROM usage_logs
       WHERE business_id = $1 ${timeFilter}`,
      [businessId]
    );

    return result.rows[0];
  }

  /**
   * Check if business has exceeded usage limits
   */
  async checkUsageLimits(businessId: number): Promise<void> {
    try {
      // Get active subscription
      const subscription = await this.getActiveSubscription(businessId);
      
      // Get current month usage
      const usage = await this.getUsageStats(businessId, 'month');
      
      const usedConversations = parseInt(usage.total_conversations || '0');
      const limit = subscription.conversation_limit;
      const usagePercent = Math.round((usedConversations / limit) * 100);

      // Send alerts at 80% and 100%
      if (usagePercent >= 80 && usagePercent < 100) {
        const userResult = await pool.query(
          'SELECT email, name FROM users WHERE business_id = $1 AND role = $2 LIMIT 1',
          [businessId, 'owner']
        );

        if (userResult.rows.length > 0) {
          await emailService.sendUsageAlertEmail(
            userResult.rows[0].email,
            userResult.rows[0].name,
            usagePercent,
            limit,
            usedConversations
          );
        }
      }

      // Suspend if over limit
      if (usagePercent >= 100) {
        await pool.query(
          `UPDATE subscriptions SET status = 'suspended' 
           WHERE business_id = $1 AND status = 'active'`,
          [businessId]
        );
        
        logger.warn(`⚠️ Business ${businessId} suspended due to usage limit exceeded`);
      }
    } catch (error) {
      logger.error('Error checking usage limits:', error);
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(businessId: number): Promise<void> {
    const subscription = await this.getActiveSubscription(businessId);

    // Cancel Stripe subscription if exists
    if (subscription.stripe_subscription_id) {
      await this.stripe.subscriptions.cancel(subscription.stripe_subscription_id);
    }

    // Update database
    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled' 
       WHERE business_id = $1 AND status = 'active'`,
      [businessId]
    );

    logger.info(`Subscription cancelled for business ${businessId}`);
  }

  /**
   * Renew subscription
   */
  async renewSubscription(businessId: number): Promise<void> {
    const subscription = await this.getActiveSubscription(businessId);

    // Calculate new renewal date
    const newRenewsAt = new Date(subscription.renews_at);
    newRenewsAt.setDate(newRenewsAt.getDate() + 30);

    // Update subscription
    await pool.query(
      `UPDATE subscriptions 
       SET renews_at = $1, status = 'active'
       WHERE business_id = $2 AND id = $3`,
      [newRenewsAt, businessId, subscription.id]
    );

    // Get plan details for email
    const planResult = await pool.query(
      'SELECT name FROM plans WHERE id = $1',
      [subscription.plan_id]
    );

    // Send confirmation email
    const userResult = await pool.query(
      'SELECT email, name FROM users WHERE business_id = $1 AND role = $2 LIMIT 1',
      [businessId, 'owner']
    );

    if (userResult.rows.length > 0 && planResult.rows.length > 0) {
      await emailService.sendSubscriptionRenewedEmail(
        userResult.rows[0].email,
        userResult.rows[0].name,
        planResult.rows[0].name,
        newRenewsAt
      );
    }

    logger.info(`Subscription renewed for business ${businessId}`);
  }

  /**
   * Generate invoice PDF
   */
  async generateInvoice(businessId: number, invoiceData: {
    period: string;
    items: Array<{ description: string; quantity: number; price: number }>;
    total: number;
  }): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Get business details
        const businessResult = await pool.query(
          'SELECT * FROM businesses WHERE id = $1',
          [businessId]
        );
        const business = businessResult.rows[0];

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });
        const filename = `invoice-${businessId}-${Date.now()}.pdf`;
        const filepath = path.join('/tmp', filename);
        const stream = fs.createWriteStream(filepath);

        doc.pipe(stream);

        // Header
        doc.fontSize(20).text('INVOICE', { align: 'center' });
        doc.moveDown();

        // Business info
        doc.fontSize(12).text(`Bill To: ${business.business_name}`);
        doc.text(`Email: ${business.email}`);
        doc.text(`Period: ${invoiceData.period}`);
        doc.text(`Date: ${new Date().toLocaleDateString()}`);
        doc.moveDown();

        // Table header
        doc.fontSize(10);
        const tableTop = 250;
        doc.text('Description', 50, tableTop, { width: 250 });
        doc.text('Quantity', 300, tableTop, { width: 80 });
        doc.text('Price', 380, tableTop, { width: 80 });
        doc.text('Total', 460, tableTop, { width: 80 });
        
        // Line under header
        doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke();

        // Items
        let yPosition = tableTop + 30;
        invoiceData.items.forEach(item => {
          doc.text(item.description, 50, yPosition, { width: 250 });
          doc.text(item.quantity.toString(), 300, yPosition, { width: 80 });
          doc.text(`$${item.price.toFixed(2)}`, 380, yPosition, { width: 80 });
          doc.text(`$${(item.quantity * item.price).toFixed(2)}`, 460, yPosition, { width: 80 });
          yPosition += 25;
        });

        // Line before total
        doc.moveTo(50, yPosition).lineTo(540, yPosition).stroke();
        yPosition += 15;

        // Total
        doc.fontSize(14).text('Total:', 380, yPosition);
        doc.text(`$${invoiceData.total.toFixed(2)}`, 460, yPosition);

        // Footer
        doc.fontSize(10).text(
          'Thank you for your business!',
          50,
          700,
          { align: 'center', width: 500 }
        );

        doc.end();

        stream.on('finish', () => {
          logger.info(`Invoice generated: ${filename}`);
          resolve(filepath);
        });

        stream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get all plans
   */
  async getAllPlans(): Promise<any[]> {
    const result = await pool.query('SELECT * FROM plans ORDER BY price ASC');
    return result.rows;
  }

  /**
   * Create a new plan
   */
  async createPlan(data: { name: string; conversationLimit: number; price: number }): Promise<any> {
    const result = await pool.query(
      `INSERT INTO plans (name, conversation_limit, price)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.conversationLimit, data.price]
    );
    
    return result.rows[0];
  }

  /**
   * Handle Stripe webhook events
   */
  async handleStripeWebhook(event: Stripe.Event): Promise<void> {
    logger.info(`Received Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      
      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const businessId = subscription.metadata.businessId;
    
    if (businessId) {
      await pool.query(
        `UPDATE subscriptions 
         SET status = $1, renews_at = to_timestamp($2)
         WHERE stripe_subscription_id = $3`,
        [subscription.status, subscription.current_period_end, subscription.id]
      );
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled'
       WHERE stripe_subscription_id = $1`,
      [subscription.id]
    );
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    logger.info(`Payment succeeded for invoice ${invoice.id}`);
    // Additional logic like sending receipt email
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    logger.error(`Payment failed for invoice ${invoice.id}`);
    // Send payment failed notification
  }
}

export const billingService = new BillingService();
export default billingService;