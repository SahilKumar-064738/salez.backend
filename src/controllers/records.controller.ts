/**
 * src/controllers/records.controller.ts
 *
 * HTTP handlers for the Records API.
 * All routes are tenant-scoped via authMiddleware + tenantContextMiddleware.
 */

import { Request, Response, NextFunction } from 'express';
import { recordsService } from '../services/records.service';
import { AuthenticatedRequest, AppError } from '../types';
import * as R from '../utils/response';

export class RecordsController {
  /**
   * GET /api/v1/records
   * List all records for the authenticated tenant.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const records = await recordsService.list(tenantId);
      R.success(res, records);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/records/:id
   * Get a single record by ID.
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid record ID', 400, 'INVALID_PARAM');

      const record = await recordsService.getById(id, tenantId);
      R.success(res, record);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/records
   * Create a new record.
   *
   * Body:
   *   client_name         string  required
   *   phone               string  required
   *   service_type        string  optional  (GST | ITR | TDS | ROC | Other)
   *   due_date            string  required  (ISO date: YYYY-MM-DD)
   *   reminder_days_before number optional  default 3
   *   data                object  optional  (custom key-value fields)
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId, id: userId } = (req as AuthenticatedRequest).user;
      const record = await recordsService.create(tenantId, userId, req.body);
      R.created(res, record, 'Record created');
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/records/:id
   * Delete a record.
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid record ID', 400, 'INVALID_PARAM');

      await recordsService.delete(id, tenantId);
      R.success(res, null, 'Record deleted');
    } catch (err) {
      next(err);
    }
  }
}

export const recordsController = new RecordsController();