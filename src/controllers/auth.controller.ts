import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient, anonClient } from '../config/supabase';
import { AuthenticatedRequest, AppError, ConflictError } from '../types';
import { generateSlug } from '../utils/crypto';
import * as R from '../utils/response';
import { logger } from '../utils/logger';

export class AuthController {
  /**
   * POST /auth/register
   * Creates a Supabase auth user + tenant + user_profile + tenant_settings atomically.
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { businessName, email, password, displayName } = req.body as {
        businessName: string; email: string; password: string; displayName: string;
      };
      
      // 1. Create auth user
      const { data: authData, error: authErr } = await serviceRoleClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });

      if (authErr) {
        if (authErr.message.includes('already registered')) throw new ConflictError('Email already registered');
        throw authErr;
      }

      const userId = authData.user.id;
      const slug = generateSlug(businessName);

      try {
        // 2. Create tenant
        const { data: tenant, error: tenantErr } = await serviceRoleClient
          .from('tenants')
          .insert({ name: businessName, email, slug, status: 'active', plan: 'free' })
          .select()
          .single();

        if (tenantErr) throw tenantErr;

        // 3. Create user profile
        const { error: profileErr } = await serviceRoleClient
          .from('user_profiles')
          .insert({ id: userId, tenant_id: tenant.id, role: 'owner', display_name: displayName, is_active: true });

        if (profileErr) throw profileErr;

        // 4. Seed tenant settings with defaults
        const { error: settingsErr } = await serviceRoleClient
  .from('tenant_settings')
  .upsert(
    { tenant_id: tenant.id },
    { onConflict: 'tenant_id' }
  );

        if (settingsErr) throw settingsErr;

        // ✅ LOGIN USER IMMEDIATELY AFTER REGISTER
        const { data: sessionData, error: loginErr } = await anonClient.auth.signInWithPassword({
          email,
          password,
        });

        if (loginErr || !sessionData.session) {
          throw new Error("User created but login failed");
        }

        console.log("REGISTER + LOGIN SUCCESS");

        // ✅ SEND TOKEN TO FRONTEND
        R.created(res, {
          userId,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          email,
          accessToken: sessionData.session.access_token,
          refreshToken: sessionData.session.refresh_token,
        }, 'Account created successfully');
      } catch (innerErr) {
        // Rollback: delete auth user if tenant setup failed
        await serviceRoleClient.auth.admin.deleteUser(userId).catch((e) =>
          logger.error({ e }, 'Failed to rollback auth user after tenant creation failure')
        );
        throw innerErr;
      }
    } catch (err: any) {
  console.log("ERROR:", err);

  // 👇 Zod specific logging
  if (err?.errors) {
    console.log("ZOD ERRORS:", err.errors);
  }

  next(err);
}
  }

  /**
   * POST /auth/login
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const tenantId = (req.headers['x-tenant-id'] as string) ?? null;

      const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        // Log failed attempt
        serviceRoleClient.from('login_attempts').insert({
          email,
          tenant_id: tenantId ? parseInt(tenantId, 10) : null,
          ip_address: req.ip ?? '0.0.0.0',
          user_agent: req.headers['user-agent'] ?? null,
          success: false,
          failure_reason: error?.message ?? 'Unknown',
        }).then(() => {});

        throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
      }

      // Load profile
      const { data: profile } = await serviceRoleClient
        .from('user_profiles')
        .select('tenant_id, role, display_name, is_active')
        .eq('id', data.user.id)
        .single();

      if (!profile?.is_active) {
        throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
      }

      // Log success
      serviceRoleClient.from('login_attempts').insert({
        email,
        tenant_id: profile?.tenant_id ?? null,
        ip_address: req.ip ?? '0.0.0.0',
        user_agent: req.headers['user-agent'] ?? null,
        success: true,
        failure_reason: null,
      }).then(() => {});

      R.success(res, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
          displayName: profile?.display_name ?? null,
          tenantId: profile?.tenant_id,
          role: profile?.role,
        },
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /auth/refresh
   */
  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) throw new AppError('refreshToken is required', 400, 'MISSING_FIELD');

      const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });

      if (error || !data.session) throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');

      R.success(res, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      });
    } catch (err) { next(err); }
  }

  /**
   * GET /auth/me
   */
  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      const { data: profile, error } = await serviceRoleClient
        .from('user_profiles')
        .select('*, tenant:tenants(id, name, slug, plan, status)')
        .eq('id', user.id)
        .single();

      if (error || !profile) throw new AppError('Profile not found', 404, 'NOT_FOUND');

      R.success(res, {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
        tenant: profile.tenant,
      });
    } catch (err) { next(err); }
  }

  /**
   * POST /auth/change-password
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, accessToken } = req as AuthenticatedRequest;
      const { password } = req.body as { password: string };

      // Use the user's own token so Supabase enforces identity
      const userClient = anonClient;
      await userClient.auth.setSession({ access_token: accessToken, refresh_token: '' });
      const { error } = await serviceRoleClient.auth.admin.updateUserById(user.id, { password });

      if (error) throw error;
      R.success(res, null, 'Password changed successfully');
    } catch (err) { next(err); }
  }

  /**
   * POST /auth/logout
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken } = req as AuthenticatedRequest;
      // Revoke the session server-side
      await anonClient.auth.admin?.signOut?.(accessToken).catch(() => {});
      R.success(res, null, 'Logged out successfully');
    } catch (err) { next(err); }
  }
}

export const authController = new AuthController();