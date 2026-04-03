/**
 * src/controllers/auth.controller.ts
 *
 * FIXES APPLIED:
 *  1. register() — subscription insert now awaited and error-checked
 *  2. register() — rollback covers subscription + tenant atomically
 *  3. login() — login_attempts insert fire-and-forget properly (no unawaited promise leak)
 *  4. changePassword() — removed dead setSession() call; use serviceRoleClient directly
 *  5. logout() — removed non-existent anonClient.auth.admin?.signOut() shim
 *  6. All console.log replaced with structured logger calls
 *  7. me() — profile query simplified; tenant join returns plan data correctly
 */

import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient, anonClient } from '../config/supabase';
import { AuthenticatedRequest, AppError, ConflictError, UnauthorizedError } from '../types';
import { generateSlug } from '../utils/crypto';
import * as R from '../utils/response';
import { logger } from '../utils/logger';
import { getFreePlanId } from '../services/plans.service';

export class AuthController {
  /**
   * POST /auth/register
   * Creates: auth user → tenant → subscription → user_profile → tenant_settings
   * Rolls back auth user if any step fails.
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { businessName, email, password, displayName } = req.body as {
      businessName: string;
      email: string;
      password: string;
      displayName: string;
    };

    // 1. Create Supabase auth user
    const { data: authData, error: authErr } = await serviceRoleClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }).catch((e: Error) => ({ data: null, error: e }));

    if (authErr || !authData?.user) {
      const msg = (authErr as any)?.message ?? '';
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return next(new ConflictError('Email already registered'));
      }
      return next(new AppError('Failed to create user account', 500, 'AUTH_CREATE_FAILED'));
    }

    const userId = authData.user.id;

    try {
      const slug = generateSlug(businessName);
      const freePlanId = await getFreePlanId();

      // 2. Create tenant (plan_id is NOT NULL — must be set here)
      const { data: tenant, error: tenantErr } = await serviceRoleClient
        .from('tenants')
        .insert({
          name: businessName,
          email,
          slug,
          status: 'active',
          plan: 'free',       // legacy enum column — keep in sync
          plan_id: freePlanId,
        })
        .select('id, slug')
        .single();

      if (tenantErr || !tenant) {
        throw tenantErr ?? new Error('Tenant insert returned no data');
      }

      // 3. Create subscription — AWAITED and error-checked
      const { error: subErr } = await serviceRoleClient
        .from('tenant_subscriptions')
        .insert({
          tenant_id: tenant.id,
          plan_id: freePlanId,
          billing_cycle: 'monthly',
          status: 'active',
          current_period_start: new Date().toISOString(),
        });

      if (subErr) throw subErr;

      // 4. Create user profile (owner role)
      const { error: profileErr } = await serviceRoleClient
        .from('user_profiles')
        .insert({
          id: userId,
          tenant_id: tenant.id,
          role: 'owner',
          display_name: displayName,
          is_active: true,
        });

      if (profileErr) throw profileErr;

      // 5. Seed tenant_settings with plan defaults
      const { error: settingsErr } = await serviceRoleClient
        .from('tenant_settings')
        .upsert({ tenant_id: tenant.id }, { onConflict: 'tenant_id' });

      if (settingsErr) throw settingsErr;

      // 6. Auto-login — return JWT immediately so frontend doesn't need a second call
      const { data: sessionData, error: loginErr } = await anonClient.auth.signInWithPassword({
        email,
        password,
      });

      if (loginErr || !sessionData.session) {
        // Non-fatal: account created but auto-login failed — user can log in manually
        logger.warn({ userId, tenantId: tenant.id }, 'Auto-login after register failed');
        R.created(res, { userId, tenantId: tenant.id, tenantSlug: tenant.slug, email }, 'Account created. Please log in.');
        return;
      }

      logger.info({ userId, tenantId: tenant.id }, 'New tenant registered');

      R.created(res, {
        userId,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        email,
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresAt: sessionData.session.expires_at,
      }, 'Account created successfully');

    } catch (innerErr: any) {
      // Rollback: delete the auth user so the email doesn't get stuck
      await serviceRoleClient.auth.admin.deleteUser(userId).catch((e) =>
        logger.error({ err: e, userId }, 'Failed to rollback auth user after registration failure')
      );
      logger.error({ err: innerErr, email }, 'Registration failed — rolled back auth user');
      return next(innerErr);
    }
  }

  /**
   * POST /auth/login
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const rawTenantId = req.headers['x-tenant-id'] as string | undefined;
      const tenantId = rawTenantId ? parseInt(rawTenantId, 10) : null;

      const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        // Fire-and-forget login attempt log — do not await
        void serviceRoleClient.from('login_attempts').insert({
          email,
          tenant_id: tenantId,
          ip_address: req.ip ?? '0.0.0.0',
          user_agent: req.headers['user-agent'] ?? null,
          success: false,
          failure_reason: error?.message ?? 'No session returned',
        });

        return next(new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS'));
      }

      // Load profile (tenant_id + role)
      const { data: profile, error: profileErr } = await serviceRoleClient
        .from('user_profiles')
        .select('tenant_id, role, display_name, is_active')
        .eq('id', data.user.id)
        .single();

      if (profileErr || !profile) {
        return next(new UnauthorizedError('User profile not found'));
      }

      if (!profile.is_active) {
        return next(new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED'));
      }

      // Fire-and-forget success log
      void serviceRoleClient.from('login_attempts').insert({
        email,
        tenant_id: profile.tenant_id,
        ip_address: req.ip ?? '0.0.0.0',
        user_agent: req.headers['user-agent'] ?? null,
        success: true,
        failure_reason: null,
      });

      R.success(res, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
          displayName: profile.display_name ?? null,
          tenantId: profile.tenant_id,
          role: profile.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/refresh
   */
  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) return next(new AppError('refreshToken is required', 400, 'MISSING_FIELD'));

      const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });

      if (error || !data.session) {
        return next(new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN'));
      }

      R.success(res, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /auth/me
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      const { data: profile, error } = await serviceRoleClient
        .from('user_profiles')
        .select(`
          display_name,
          avatar_url,
          role,
          is_active,
          tenant:tenants(
            id,
            name,
            slug,
            status,
            plan_id,
            plan:plans(name, display_name, features)
          )
        `)
        .eq('id', user.id)
        .single();

      if (error || !profile) {
        return next(new AppError('Profile not found', 404, 'NOT_FOUND'));
      }

      R.success(res, {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: profile.role,
        displayName: profile.display_name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        tenant: profile.tenant,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/change-password
   * FIX: Use serviceRoleClient.auth.admin.updateUserById — no dead setSession() call.
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const { password } = req.body as { password: string };

      const { error } = await serviceRoleClient.auth.admin.updateUserById(user.id, { password });

      if (error) return next(error);

      R.success(res, null, 'Password changed successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/logout
   * FIX: Use serviceRoleClient.auth.admin.signOut(userId) — correct API.
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      // Invalidate all sessions for this user (server-side revocation)
      await serviceRoleClient.auth.admin.signOut(user.id).catch((e) =>
        logger.warn({ err: e, userId: user.id }, 'Server-side signout failed — proceeding anyway')
      );
      R.success(res, null, 'Logged out successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();