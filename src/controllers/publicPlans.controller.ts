/**
 * src/controllers/publicPlans.controller.ts
 *
 * Public (unauthenticated) endpoint that returns active plans.
 * Used by the frontend Pricing page and BillingPage.
 *
 * The existing plans.controller.ts is admin-only (under /admin/plans).
 * This controller serves the public GET /api/v1/plans endpoint.
 */

import { Request, Response, NextFunction } from 'express';
import { plansService } from '../services/plans.service';
import * as R from '../utils/response';

export class PublicPlansController {
  /**
   * GET /api/v1/plans
   *
   * Returns all active plans with their limits and features.
   * No authentication required — used by pricing pages.
   *
   * Response shape per plan:
   *   id, name, display_name, price_monthly, price_yearly,
   *   max_users, max_contacts, max_whatsapp_accounts,
   *   max_campaigns, max_api_keys, max_campaign_recipients,
   *   max_message_templates, rate_limit_per_minute,
   *   features, sort_order
   */
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const plans = await plansService.listPlans();

      // Shape the response to exactly what the frontend expects
      const shaped = plans.map((p) => ({
        id: p.id,
        name: p.name,
        display_name: p.display_name,
        price: p.price_monthly,          // primary price field frontend reads
        price_monthly: p.price_monthly,
        price_yearly: p.price_yearly,
        limits: {
          max_users: p.max_users,
          max_contacts: p.max_contacts,
          max_whatsapp_accounts: p.max_whatsapp_accounts,
          max_campaigns: p.max_campaigns,
          max_api_keys: p.max_api_keys,
          max_campaign_recipients: p.max_campaign_recipients,
          max_message_templates: p.max_message_templates,
          rate_limit_per_minute: p.rate_limit_per_minute,
        },
        features: p.features,
        sort_order: p.sort_order,
      }));

      R.success(res, shaped);
    } catch (err) {
      next(err);
    }
  }
}

export const publicPlansController = new PublicPlansController();