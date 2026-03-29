import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest, ForbiddenError } from '../types';
import { logger } from '../utils/logger';

/**
 * FIXED: Previously checked user.role === 'owner' which is a TENANT-LEVEL role.
 * Any tenant owner could access /admin routes and manage ALL other tenants — critical
 * security hole.
 *
 * Super-admin status is now stored in Supabase Auth user_metadata:
 *   { is_super_admin: true }
 *
 * This is set only by direct DB access / Supabase dashboard, never via API.
 * It is completely separate from the tenant user_profiles.role column.
 */
export async function requireSuperAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { user } = req as AuthenticatedRequest;

  try {
    const { data: { user: authUser }, error } = await serviceRoleClient.auth.admin.getUserById(user.id);

    if (error || !authUser) {
      return next(new ForbiddenError('Super-admin access required'));
    }

    const isSuperAdmin = authUser.user_metadata?.is_super_admin === true;

    if (!isSuperAdmin) {
      logger.warn({ userId: user.id }, 'Non-super-admin attempted to access admin route');
      return next(new ForbiddenError('Super-admin access required'));
    }

    next();
  } catch (err) {
    logger.error({ err }, 'requireSuperAdmin check failed');
    next(new ForbiddenError('Super-admin verification failed'));
  }
}

/**
 * Role gate for tenant-scoped routes.
 * Restricts to owner or admin within the same tenant.
 */
export function requireOwnerOrAdmin(req: Request, _res: Response, next: NextFunction): void {
  const { user } = req as AuthenticatedRequest;
  if (!['owner', 'admin'].includes(user.role)) {
    return next(new ForbiddenError('Requires owner or admin role'));
  }
  next();
}

/**
 * Audit logger — records every admin action to admin_audit_log.
 * Fire-and-forget: a logging failure must NEVER block the request.
 */
export function auditLog(action: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const { user } = req as AuthenticatedRequest;

    // Non-blocking — log in background
    serviceRoleClient
      .from('admin_audit_log')
      .insert({
        user_id: user?.id ?? null,
        tenant_id: user?.tenantId ?? null,
        action,
        method: req.method,
        path: req.path,
        params: req.params,
        body_keys: req.body ? Object.keys(req.body) : [],
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
        created_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) logger.warn({ error }, 'Failed to write audit log (non-fatal)');
      });

    next();
  };
}
