import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { billingService } from '../services/billing.service.js';
import { logger } from '../utils/logger.js';
import Stripe from 'stripe';

const router = express.Router();

/**
 * GET /api/billing/plans
 * Get all available plans
 */
router.get('/plans', async (req, res, next) => {
  try {
    const plans = await billingService.getAllPlans();
    res.json({ plans });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/plans
 * Create a new plan (admin only)
 */
router.post('/plans', authenticate, async (req, res, next) => {
  try {
    const { name, conversationLimit, price } = req.body;

    if (!name || !conversationLimit || !price) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, conversationLimit, price' 
      });
    }

    const plan = await billingService.createPlan({
      name,
      conversationLimit: parseInt(conversationLimit),
      price: parseFloat(price)
    });

    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/subscription
 * Get active subscription for authenticated business
 */
router.get('/subscription', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const subscription = await billingService.getActiveSubscription(businessId);
    
    res.json({ subscription });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscription
 * Create or update subscription
 */
router.post('/subscription', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const { planId, stripePaymentMethodId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const subscription = await billingService.createSubscription({
      businessId,
      planId: parseInt(planId),
      stripeCustomerId: undefined
    });

    res.status(201).json({ 
      message: 'Subscription created successfully',
      subscription 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/billing/subscription
 * Cancel subscription
 */
router.delete('/subscription', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    
    await billingService.cancelSubscription(businessId);
    
    res.json({ message: 'Subscription cancelled successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscription/renew
 * Manually renew subscription
 */
router.post('/subscription/renew', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    
    await billingService.renewSubscription(businessId);
    
    res.json({ message: 'Subscription renewed successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/usage
 * Get usage statistics
 */
router.get('/usage', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const { period = 'month' } = req.query;

    const usage = await billingService.getUsageStats(
      businessId, 
      period as 'day' | 'month' | 'all'
    );

    res.json({ usage });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/usage
 * Track usage (internal endpoint)
 */
router.post('/usage', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const { conversationId, cost } = req.body;

    if (!conversationId || cost === undefined) {
      return res.status(400).json({ 
        error: 'conversationId and cost are required' 
      });
    }

    await billingService.trackUsage({
      businessId,
      conversationId,
      cost: parseFloat(cost)
    });

    res.json({ message: 'Usage tracked successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/invoice/generate
 * Generate invoice PDF
 */
router.post('/invoice/generate', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const { period, items, total } = req.body;

    if (!period || !items || !total) {
      return res.status(400).json({ 
        error: 'period, items, and total are required' 
      });
    }

    const invoicePath = await billingService.generateInvoice(businessId, {
      period,
      items,
      total: parseFloat(total)
    });

    // Send the PDF file
    res.download(invoicePath);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook endpoint
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    if (!webhookSecret) {
      logger.error('Stripe webhook secret not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2024-12-18.acacia',
    });

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      logger.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Handle the event
    await billingService.handleStripeWebhook(event);

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/check-limits
 * Check if business has reached usage limits
 */
router.get('/check-limits', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    
    // Get subscription and usage
    const subscription = await billingService.getActiveSubscription(businessId);
    const usage = await billingService.getUsageStats(businessId, 'month');

    const limit = subscription.conversation_limit;
    const used = parseInt(usage.total_conversations || '0');
    const remaining = limit - used;
    const usagePercent = Math.round((used / limit) * 100);

    res.json({
      limit,
      used,
      remaining,
      usagePercent,
      canContinue: used < limit,
      planName: subscription.plan_name
    });
  } catch (error) {
    next(error);
  }
});

export default router;