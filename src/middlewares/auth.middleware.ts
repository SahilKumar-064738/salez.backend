import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest, UnauthorizedError } from '../types';
import { logger } from '../utils/logger';

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
    const { data: { user }, error } = await serviceRoleClient.auth.getUser(token);
    if (error || !user) return next(new UnauthorizedError('Invalid or expired token'));

    const { data: profile, error: profileErr } = await serviceRoleClient
      .from('user_profiles')
      .select('tenant_id, role, is_active')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) return next(new UnauthorizedError('User profile not found'));
    if (!profile.is_active) return next(new UnauthorizedError('Account is deactivated'));

    const r = req as AuthenticatedRequest;
    r.user = { id: user.id, email: user.email ?? '', tenantId: profile.tenant_id, role: profile.role };
    r.accessToken = token;
    next();
  } catch (err) {
    logger.error({ err }, 'Auth middleware error');
    next(new UnauthorizedError('Authentication failed'));
  }
}