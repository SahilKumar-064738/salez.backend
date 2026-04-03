import { Router } from 'express';
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
import { callsController } from '../controllers/calls.controller';

const router = Router();

// All contact routes require auth + tenant context
router.use(authMiddleware, tenantContextMiddleware);

// ── READ ──────────────────────────────────────────────────────────────────────
router.get(
  '/',
  validate(ContactsQuerySchema, 'query'),
  (req, res, next) => contactsController.list(req, res, next)
);

router.get(
  '/pipeline-stats',
  (req, res, next) => contactsController.getPipelineStats(req, res, next)
);

router.get(
  '/:id',
  (req, res, next) => contactsController.getById(req, res, next)
);

router.get(
  '/:contactId/calls',
  (req, res, next) => callsController.getContactCalls(req, res, next)
);

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post(
  '/',
  enforceLimit('contacts', 'max_contacts'),
  validate(CreateContactSchema),
  (req, res, next) => contactsController.create(req, res, next)
);

/**
 * POST /contacts/bulk
 * Plan limit is checked against current count + incoming batch size.
 * The enforceLimit middleware counts existing contacts BEFORE the insert.
 * Additional recipients-count check happens inside the controller via
 * BulkCreateContactSchema (max 500 per batch).
 */
router.post(
  '/bulk',
  enforceLimit('contacts', 'max_contacts'),
  validate(BulkCreateContactSchema),
  (req, res, next) => contactsController.bulkCreate(req, res, next)
);

// ── UPDATE / DELETE ───────────────────────────────────────────────────────────
router.patch(
  '/:id',
  validate(UpdateContactSchema),
  (req, res, next) => contactsController.update(req, res, next)
);

router.delete(
  '/:id',
  (req, res, next) => contactsController.delete(req, res, next)
);

// ── TAGS ──────────────────────────────────────────────────────────────────────
router.post(
  '/:id/tags',
  validate(TagSchema),
  (req, res, next) => contactsController.addTag(req, res, next)
);

router.delete(
  '/:id/tags/:tag',
  (req, res, next) => contactsController.removeTag(req, res, next)
);

export { router as contactsRouter };