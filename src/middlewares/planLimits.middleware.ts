/**
 * src/middlewares/planLimits.middleware.ts
 *
 * Factory functions for plan-limit enforcement.
 * Must run AFTER authMiddleware + tenantContextMiddleware.
 *
 * FIXES APPLIED:
 *  1. COUNT_FNS registry is type-safe (no implicit any).
 *  2. enforceLimit — limit-check failure now logs tenantId + resource for easy
 *     alerting; does not silently swallow the error.
 *  3. enforceCampaignRecipientLimit — handles both contactIds array AND
 *     a totalRecipients number (some call sites pass total, not the array).
 *  4. enforceLimit factory throws at route-registration time (not per-request)
 *     when an unregistered resource key is used — fail fast.
 */

import type { Request, Response, NextFunction } from 'express';
import { plansService, LimitKey, FeatureKey } from '../services/plans.service';
import { AuthenticatedRequest, AppError } from '../types';
import { logger } from '../utils/logger';

// ── Count function registry ────────────────────────────────────────────────────

type CountFn = (tenantId: number) => Promise<number>;

const COUNT_FNS: Readonly<Record<string, CountFn>> = {
  contacts:           (id) => plansService.countContacts(id),
  users:              (id) => plansService.countUsers(id),
  whatsapp_accounts:  (id) => plansService.countWhatsAppAccounts(id),
  campaigns:          (id) => plansService.countCampaigns(id),
  api_keys:           (id) => plansService.countApiKeys(id),
  message_templates:  (id) => plansService.countMessageTemplates(id),
} as const;

// ── enforceLimit ──────────────────────────────────────────────────────────────

/**
 * Route-level guard: counts the resource and returns 429 if at/over plan limit.
 *
 * @param resource  key in COUNT_FNS — e.g. 'contacts'
 * @param limitKey  column in PlanLimits — e.g. 'max_contacts'
 * @param label     optional human-readable label used in error message
 *
 * Throws at route-registration time if `resource` is not in COUNT_FNS.
 *
 * Usage:
 *   router.post('/', enforceLimit('contacts', 'max_contacts', 'Contacts'), handler)
 */
export function enforceLimit(resource: string, limitKey: LimitKey, label?: string) {
  const countFn = COUNT_FNS[resource];

  if (!countFn) {
    // Fail fast at startup, not per-request
    throw new Error(
      `enforceLimit: unknown resource "${resource}". ` +
      `Valid resources: ${Object.keys(COUNT_FNS).join(', ')}`
    );
  }

  const resourceLabel = label ?? resource.replace(/_/g, ' ');

  return async function planLimitGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { user } = req as AuthenticatedRequest;

    try {
      const [limits, current] = await Promise.all([
        plansService.getEffectiveLimits(user.tenantId),
        countFn(user.tenantId),
      ]);

      const max = limits[limitKey] as number;

      if (current >= max) {
        logger.warn(
          { tenantId: user.tenantId, resource, current, max },
          'Plan limit exceeded — request blocked',
        );
        return next(
          new AppError(
            `You have reached your plan limit for ${resourceLabel} (${current}/${max}). Upgrade your plan to add more.`,
            429,
            'LIMIT_EXCEEDED',
          ),
        );
      }

      return next();
    } catch (err) {
      logger.error({ err, tenantId: (req as AuthenticatedRequest).user?.tenantId, resource }, 'enforceLimit threw');
      return next(err);
    }
  };
}

// ── enforceFeature ────────────────────────────────────────────────────────────

/**
 * Route-level guard: returns 403 if a plan feature flag is disabled.
 *
 * @param feature  e.g. 'automation', 'ivr', 'call_recording'
 *
 * Usage:
 *   router.post('/', enforceFeature('automation'), handler)
 */
export function enforceFeature(feature: FeatureKey) {
  return async function featureGuard(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { user } = req as AuthenticatedRequest;

    try {
      const limits = await plansService.getEffectiveLimits(user.tenantId);

      if (!limits.features[feature]) {
        logger.warn(
          { tenantId: user.tenantId, feature },
          'Feature not available on current plan',
        );
        return next(
          new AppError(
            `The "${feature}" feature is not available on your current plan. Upgrade to unlock it.`,
            403,
            'FEATURE_NOT_AVAILABLE',
          ),
        );
      }

      return next();
    } catch (err) {
      logger.error({ err, tenantId: (req as AuthenticatedRequest).user?.tenantId, feature }, 'enforceFeature threw');
      return next(err);
    }
  };
}

// ── enforceCampaignRecipientLimit ─────────────────────────────────────────────

/**
 * Guards campaign creation when an explicit contactIds array is provided.
 * Also accepts a `recipientCount` number for calls that pre-compute the count.
 *
 * Defers enforcement to the worker when neither is present (dynamic audience).
 */
export async function enforceCampaignRecipientLimit(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const { user } = req as AuthenticatedRequest;
  const { contactIds, recipientCount } = req.body as {
    contactIds?: number[];
    recipientCount?: number;
  };

  // Determine the count to check
  let count: number;
  if (Array.isArray(contactIds)) {
    count = contactIds.length;
  } else if (typeof recipientCount === 'number') {
    count = recipientCount;
  } else {
    // Dynamic audience — enforce in the worker
    return next();
  }

  try {
    const limits = await plansService.getEffectiveLimits(user.tenantId);
    const max = limits.max_campaign_recipients;

    if (count > max) {
      logger.warn({ tenantId: user.tenantId, count, max }, 'Campaign recipient limit exceeded');
      return next(
        new AppError(
          `Campaign recipient count (${count}) exceeds your plan limit of ${max}. Upgrade your plan.`,
          429,
          'LIMIT_EXCEEDED',
        ),
      );
    }

    return next();
  } catch (err) {
    logger.error({ err, tenantId: user.tenantId }, 'enforceCampaignRecipientLimit threw');
    return next(err);
  }
}