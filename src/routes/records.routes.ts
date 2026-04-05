/**
 * src/routes/records.routes.ts
 *
 * Mounts the Records API under /api/v1/records.
 * All routes require authentication + tenant context.
 */

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { tenantContextMiddleware } from '../middlewares/tenantContext.middleware';
import { recordsController } from '../controllers/records.controller';

export const recordsRouter = Router();

const withTenant = [authMiddleware, tenantContextMiddleware];

recordsRouter.use(...withTenant);

recordsRouter.get('/',     (req, res, next) => recordsController.list(req, res, next));
recordsRouter.post('/',    (req, res, next) => recordsController.create(req, res, next));
recordsRouter.get('/:id',  (req, res, next) => recordsController.getById(req, res, next));
recordsRouter.delete('/:id', (req, res, next) => recordsController.delete(req, res, next));