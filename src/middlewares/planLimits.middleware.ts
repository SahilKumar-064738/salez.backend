/**
 * src/middlewares/planLimits.middleware.ts
 *
 * Factory functions for plan-limit enforcement.
 * Run AFTER authMiddleware + tenantContextMiddleware so req.user.tenantId is set.
 *
 * Error shape returned when a limit is exceeded:
 * {
 *   "success": false,
 *   "error": "LIMIT_EXCEEDED",
 *   "message": "You have reached your plan limit for contacts (500/500). Upgrade your plan.",
 *   "statusCode": 429
 * }
 */

import type { Request, Response, NextFunction } from 'express';
import { plansService, LimitKey, FeatureKey } from '../services/plans.service';
import { AuthenticatedRequest, AppError } from '../types';
import { logger } from '../utils/logger';

// ── Count function registry ───────────────────────────────────────────────────

type CountFn = (tenantId: number) => Promise<number>;

const COUNT_FNS: Record<string, CountFn> = {
  contacts: (id) => plansService.countContacts(id),
  users: (id) => plansService.countUsers(id),
  whatsapp_accounts: (id) => plansService.countWhatsAppAccounts(id),
  campaigns: (id) => plansService.countCampaigns(id),
  api_keys: (id) => plansService.countApiKeys(id),
  message_templates: (id) => plansService.countMessageTemplates(id),
};

// ── enforceLimit ─────────────────────────────────────────────────────────────

/**
 * Route-level guard: counts the resource and throws 429 if at/over limit.
 *
 * @param resource  key in COUNT_FNS (e.g. 'contacts')
 * @param limitKey  column in PlanLimits (e.g. 'max_contacts')
 * @param label     human-readable name used in error message
 */
export function enforceLimit(resource: string, limitKey: LimitKey, label?: string) {
  const resourceLabel = label ?? resource.replace(/_/g, ' ');
  const countFn = COUNT_FNS[resource];

  if (!countFn) {
    throw new Error(
      `enforceLimit: unknown resource "${resource}". Register a count function in COUNT_FNS.`
    );
  }

  return async function planLimitGuard(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    const { user } = req as AuthenticatedRequest;

    try {
      const limits = await plansService.getEffectiveLimits(user.tenantId);
      const max = limits[limitKey] as number;
      const current = await countFn(user.tenantId);

      if (current >= max) {
        logger.warn(
          { tenantId: user.tenantId, resource, current, max },
          'Plan limit exceeded'
        );
        return next(
          new AppError(
            `You have reached your plan limit for ${resourceLabel} (${current}/${max}). Upgrade your plan to add more.`,
            429,
            'LIMIT_EXCEEDED'
          )
        );
      }

      return next();
    } catch (err) {
      // If the limit check itself fails, pass the error downstream
      return next(err);
    }
  };
}

// ── enforceFeature ────────────────────────────────────────────────────────────

/**
 * Route-level guard: blocks if a plan feature flag is disabled.
 *
 * @param feature  e.g. 'automation', 'ivr', 'call_recording'
 */
export function enforceFeature(feature: FeatureKey) {
  return async function featureGuard(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    const { user } = req as AuthenticatedRequest;

    try {
      const limits = await plansService.getEffectiveLimits(user.tenantId);

      if (!limits.features[feature]) {
        logger.warn(
          { tenantId: user.tenantId, feature },
          'Feature not available on current plan'
        );
        return next(
          new AppError(
            `The "${feature}" feature is not available on your current plan. Upgrade to unlock it.`,
            403,
            'FEATURE_NOT_AVAILABLE'
          )
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// ── enforceCampaignRecipientLimit ─────────────────────────────────────────────

/**
 * Guards campaign creation when an explicit contactIds array is provided.
 * Defers enforcement to the worker when using dynamic audience filters.
 */
export async function enforceCampaignRecipientLimit(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { user } = req as AuthenticatedRequest;
  const { contactIds } = req.body as { contactIds?: number[] };

  if (!Array.isArray(contactIds)) return next();

  try {
    const limits = await plansService.getEffectiveLimits(user.tenantId);
    const max = limits.max_campaign_recipients;

    if (contactIds.length > max) {
      return next(
        new AppError(
          `Campaign recipient count (${contactIds.length}) exceeds your plan limit of ${max}. Upgrade your plan.`,
          429,
          'LIMIT_EXCEEDED'
        )
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
}