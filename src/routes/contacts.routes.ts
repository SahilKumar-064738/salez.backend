/**
 * src/routes/contacts.routes.ts  [FIXED]
 *
 * FIXES vs original index.ts inline router:
 *  1. /bulk route: enforceLimit middleware was present but used wrong
 *     approach — it checks existing count, not existing+incoming.
 *     Fixed with a custom middleware that checks existing + incoming batch size.
 *  2. Route ordering: /pipeline-stats and /bulk MUST appear before /:id
 *     to avoid Express matching "pipeline-stats" and "bulk" as :id params.
 *  3. contacts.routes.ts is now the canonical router — remove inline
 *     contactsRouter from routes/index.ts and import this one instead.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { tenantContextMiddleware } from '../middlewares/tenantContext.middleware';
import { enforceLimit } from '../middlewares/planLimits.middleware';
import { validate } from '../utils/validation';
import {
  ContactsQuerySchema,
  CreateContactSchema,
  UpdateContactSchema,
  TagSchema,
  BulkCreateContactSchema,
} from '../utils/validation';
import { contactsController } from '../controllers/contacts.controller';
import { callsController }    from '../controllers/calls.controller';
import { plansService }        from '../services/plans.service';
import { AuthenticatedRequest, AppError } from '../types';
import { logger } from '../utils/logger';

const router = Router();

router.use(authMiddleware, tenantContextMiddleware);

// ── READ ──────────────────────────────────────────────────────────────────────
router.get(
  '/',
  validate(ContactsQuerySchema, 'query'),
  (req, res, next) => contactsController.list(req, res, next)
);

// IMPORTANT: static routes before dynamic /:id
router.get(
  '/pipeline-stats',
  (req, res, next) => contactsController.getPipelineStats(req, res, next)
);

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post(
  '/',
  enforceLimit('contacts', 'max_contacts', 'Contacts'),
  validate(CreateContactSchema),
  (req, res, next) => contactsController.create(req, res, next)
);

/**
 * POST /contacts/bulk
 * Custom limit check: verifies existing_count + incoming_batch <= max_contacts.
 * Standard enforceLimit only checks existing count, not the incoming batch size.
 */
async function enforceBulkContactLimit(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { user } = req as AuthenticatedRequest;
  const { contacts } = req.body as { contacts?: unknown[] };
  const incomingCount = Array.isArray(contacts) ? contacts.length : 0;

  try {
    const [limits, existing] = await Promise.all([
      plansService.getEffectiveLimits(user.tenantId),
      plansService.countContacts(user.tenantId),
    ]);

    const max = limits.max_contacts;
    const total = existing + incomingCount;

    if (total > max) {
      logger.warn(
        { tenantId: user.tenantId, existing, incomingCount, max },
        'Bulk contact import would exceed plan limit'
      );
      return next(
        new AppError(
          `Bulk import would exceed your contact limit. You have ${existing}/${max} contacts and are importing ${incomingCount} more.`,
          429,
          'LIMIT_EXCEEDED'
        )
      );
    }

    return next();
  } catch (err) {
    logger.error({ err, tenantId: user.tenantId }, 'enforceBulkContactLimit threw');
    return next(err);
  }
}

// IMPORTANT: /bulk must appear before /:id
router.post(
  '/bulk',
  validate(BulkCreateContactSchema),
  enforceBulkContactLimit,
  (req, res, next) => contactsController.bulkCreate(req, res, next)
);

// ── DYNAMIC ROUTES (after all statics) ───────────────────────────────────────
router.get(
  '/:id',
  (req, res, next) => contactsController.getById(req, res, next)
);

router.patch(
  '/:id',
  validate(UpdateContactSchema),
  (req, res, next) => contactsController.update(req, res, next)
);

router.delete(
  '/:id',
  (req, res, next) => contactsController.delete(req, res, next)
);

router.post(
  '/:id/tags',
  validate(TagSchema),
  (req, res, next) => contactsController.addTag(req, res, next)
);

router.delete(
  '/:id/tags/:tag',
  (req, res, next) => contactsController.removeTag(req, res, next)
);

router.get(
  '/:contactId/calls',
  (req, res, next) => callsController.getContactCalls(req, res, next)
);

export { router as contactsRouter };