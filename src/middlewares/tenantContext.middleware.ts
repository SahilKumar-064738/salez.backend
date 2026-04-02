/**
 * src/middleware/tenantContext.ts
 *
 * PURPOSE: Set app.tenant_id in PostgreSQL for the current transaction
 *          so RLS policies activate on every DB query in this request.
 *
 * CALL ORDER in Express pipeline:
 *   1. authMiddleware or apiKeyMiddleware  → attaches req.user.tenantId or req.tenantId
 *   2. tenantContextMiddleware             → calls set_tenant_context(tenantId) in DB
 *   3. Controller / repository            → all queries now filtered by RLS
 *
 * WHY: serviceRoleClient bypasses RLS by default. Calling set_tenant_context()
 *      on the connection ensures the RLS policies in 4_rls.sql activate
 *      even for service-role queries — defence in depth.
 *
 * IMPORTANT: Uses Supabase rpc() which runs in its own connection from the pool.
 *            Because is_local=true, the setting resets when the connection
 *            returns to the pool. This is safe for pooled connections.
 */

import type { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { logger } from '../utils/logger';
import { UnauthorizedError } from '../types';

// Augment the Express Request interface (add if not already declared in types/)
declare global {
  namespace Express {
    interface Request {
      tenantId?: number;  // set by apiKeyMiddleware for API-key routes
    }
  }
}

/**
 * Resolve tenant ID from the request.
 * Supports both JWT-authenticated requests (req.user.tenantId)
 * and API-key-authenticated requests (req.tenantId).
 */
function resolveTenantId(req: Request): number | null {
  // JWT path: authMiddleware sets req.user
  if ((req as any).user?.tenantId) {
    return (req as any).user.tenantId as number;
  }
  // API-key path: apiKeyMiddleware sets req.tenantId
  if (req.tenantId) {
    return req.tenantId;
  }
  return null;
}

/**
 * Express middleware that sets the PostgreSQL app.tenant_id context
 * before any DB query runs in this request.
 *
 * Usage — mount AFTER auth middleware, BEFORE controllers:
 *   router.use(authMiddleware, tenantContextMiddleware, controller.method)
 *
 * Or globally on the authenticated sub-router:
 *   authenticatedRouter.use(tenantContextMiddleware);
 */
export async function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = resolveTenantId(req);

  if (!tenantId) {
    // This should never happen if authMiddleware ran first, but guard anyway
    logger.warn(
      { path: req.path, method: req.method },
      'tenantContextMiddleware: tenant_id missing on authenticated request'
    );
    return next(new UnauthorizedError('Tenant context missing'));
  }

  try {
    // Set app.tenant_id in the DB — is_local=true means it resets after
    // the current transaction ends, so pooled connections are safe.
    const { error } = await serviceRoleClient.rpc('set_tenant_context', {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error({ error, tenantId }, 'Failed to set tenant context in DB');
      return next(new UnauthorizedError('Failed to establish tenant context'));
    }

    logger.debug({ tenantId, path: req.path }, 'Tenant context set');
    next();
  } catch (err) {
    logger.error({ err, tenantId }, 'tenantContextMiddleware threw');
    next(new UnauthorizedError('Tenant context error'));
  }
}

/**
 * Utility: set tenant context for background workers / queue jobs
 * that don't go through the HTTP middleware chain.
 *
 * Usage in workers:
 *   await setTenantContextForWorker(tenantId);
 *   // ... then run queries
 */
export async function setTenantContextForWorker(tenantId: number): Promise<void> {
  const { error } = await serviceRoleClient.rpc('set_tenant_context', {
    p_tenant_id: tenantId,
  });
  if (error) {
    throw new Error(`Failed to set tenant context for worker: ${error.message}`);
  }
}