import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest, UnauthorizedError } from '../types';
import { logger } from '../utils/logger';

/**
 * authMiddleware
 *
 * Validates the Bearer token from the Authorization header.
 * Attaches `req.user` with { id, email, tenantId, role } on success.
 *
 * FIX: Added explicit `return` on every early-exit branch to prevent
 * "headers already sent" errors caused by calling next() after res.json().
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    const {
      data: { user },
      error,
    } = await serviceRoleClient.auth.getUser(token);

    if (error || !user) {
      return next(new UnauthorizedError('Invalid or expired token'));
    }

    const { data: profile, error: profileErr } = await serviceRoleClient
      .from('user_profiles')
      .select('tenant_id, role, is_active')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      return next(new UnauthorizedError('User profile not found'));
    }

    if (!profile.is_active) {
      return next(new UnauthorizedError('Account is deactivated'));
    }

    const r = req as AuthenticatedRequest;
    r.user = {
      id: user.id,
      email: user.email ?? '',
      tenantId: profile.tenant_id,
      role: profile.role,
    };
    r.accessToken = token;

    return next();
  } catch (err) {
    logger.error({ err }, 'Auth middleware error');
    return next(new UnauthorizedError('Authentication failed'));
  }
}

/**
 * requireRole
 * Usage: router.delete('/:id', requireRole('admin', 'owner'), handler)
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { user } = req as AuthenticatedRequest;
    if (!roles.includes(user.role)) {
      return next(
        new UnauthorizedError(
          `This action requires one of the following roles: ${roles.join(', ')}`
        )
      );
    }
    next();
  };
}