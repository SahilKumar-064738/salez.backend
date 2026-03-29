import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest, NotFoundError, ForbiddenError } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';

// ── SCHEMA ────────────────────────────────────────────────────────────────────

const UpdateSettingsSchema = z.object({
  max_users: z.number().int().min(1).max(500).optional(),
  max_contacts: z.number().int().min(100).max(10_000_000).optional(),
  max_whatsapp_accounts: z.number().int().min(1).max(50).optional(),
  max_campaigns: z.number().int().min(1).max(1000).optional(),
  timezone: z.string().max(50).optional(),
  webhook_url: z.string().url().nullable().optional(),
});

// ── CONTROLLER ────────────────────────────────────────────────────────────────

export class TenantSettingsController {
  /**
   * GET /settings
   * Returns settings for the authenticated user's tenant.
   */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      const { data, error } = await serviceRoleClient
        .from('tenant_settings')
        .select('tenant_id, max_users, max_contacts, max_whatsapp_accounts, max_campaigns, timezone, webhook_url, updated_at')
        .eq('tenant_id', user.tenantId)
        .single();

      if (error || !data) throw new NotFoundError('Tenant settings');
      R.success(res, data);
    } catch (e) { next(e); }
  }

  /**
   * PATCH /settings
   * Update settings. Only owner or admin can update.
   * webhook_secret_hash is never returned.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can update settings');
      }

      const body = UpdateSettingsSchema.parse(req.body);

      const { data, error } = await serviceRoleClient
        .from('tenant_settings')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('tenant_id', user.tenantId)
        .select('tenant_id, max_users, max_contacts, max_whatsapp_accounts, max_campaigns, timezone, webhook_url, updated_at')
        .single();

      if (error || !data) throw new NotFoundError('Tenant settings');
      R.success(res, data, 'Settings updated');
    } catch (e) { next(e); }
  }

  /**
   * POST /settings/webhook-secret
   * Rotate webhook secret. Returns the new plaintext secret ONCE.
   * Stores only its HMAC hash.
   */
  async rotateWebhookSecret(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (user.role !== 'owner') {
        throw new ForbiddenError('Only owners can rotate the webhook secret');
      }

      const { randomBytes, createHash } = await import('crypto');
      const secret = `whsec_${randomBytes(32).toString('hex')}`;
      const hash = createHash('sha256').update(secret).digest('hex');

      const { error } = await serviceRoleClient
        .from('tenant_settings')
        .update({ webhook_secret_hash: hash, updated_at: new Date().toISOString() })
        .eq('tenant_id', user.tenantId);

      if (error) throw error;

      R.success(res, { webhook_secret: secret }, 'Webhook secret rotated — save this now, it will not be shown again');
    } catch (e) { next(e); }
  }
}

export const tenantSettingsController = new TenantSettingsController();
