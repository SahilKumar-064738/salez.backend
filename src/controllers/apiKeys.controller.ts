import { Request, Response, NextFunction } from 'express';
import { apiKeysRepository } from '../repositories/apiKeys.repository';
import { AuthenticatedRequest, ForbiddenError } from '../types';
import { validate } from '../utils/validation';
import { CreateApiKeySchema } from '../utils/validation';
import * as R from '../utils/response';
import { z } from 'zod';

const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export class ApiKeysController {
  /**
   * GET /api-keys
   * List all API keys for the authenticated tenant.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const keys = await apiKeysRepository.list(user.tenantId);
      R.success(res, keys);
    } catch (err) { next(err); }
  }

  /**
   * GET /api-keys/:id
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const key = await apiKeysRepository.findById(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, key);
    } catch (err) { next(err); }
  }

  /**
   * POST /api-keys
   * Create a new API key. Only owner/admin may create keys.
   * raw_key is shown ONCE in the response — not stored.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can create API keys');
      }

      const body = CreateApiKeySchema.parse(req.body);
      const key = await apiKeysRepository.create(user.tenantId, user.id, {
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
      });

      R.created(res, key, 'API key created — save the raw_key now, it will not be shown again');
    } catch (err) { next(err); }
  }

  /**
   * PATCH /api-keys/:id
   * Update name, scopes, or expiry on an existing key.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can update API keys');
      }

      const body = UpdateApiKeySchema.parse(req.body);
      const key = await apiKeysRepository.update(
        user.tenantId,
        parseInt(req.params.id, 10),
        { name: body.name, scopes: body.scopes, expiresAt: body.expiresAt }
      );

      R.success(res, key, 'API key updated');
    } catch (err) { next(err); }
  }

  /**
   * DELETE /api-keys/:id
   * Revoke (soft-delete) a key. Only owner/admin may revoke.
   */
  async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can revoke API keys');
      }

      await apiKeysRepository.revoke(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, null, 'API key revoked');
    } catch (err) { next(err); }
  }
}

export const apiKeysController = new ApiKeysController();
