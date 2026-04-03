// src/services/plans.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Central service for plan/limit lookups and enforcement.
// All limit checks go through here — never inline DB queries in controllers.
// ─────────────────────────────────────────────────────────────────────────────

import { serviceRoleClient } from '../config/supabase';
import { AppError } from '../types';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanLimits {
  max_users: number;
  max_contacts: number;
  max_whatsapp_accounts: number;
  max_campaigns: number;
  max_api_keys: number;
  rate_limit_per_minute: number;
  max_campaign_recipients: number;
  max_message_templates: number;
  features: Record<string, boolean>;
}

export interface Plan {
  id: number;
  name: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  max_users: number;
  max_contacts: number;
  max_whatsapp_accounts: number;
  max_campaigns: number;
  max_api_keys: number;
  rate_limit_per_minute: number;
  max_campaign_recipients: number;
  max_message_templates: number;
  features: Record<string, boolean>;
  is_active: boolean;
  sort_order: number;
}

export type LimitKey = keyof Omit<PlanLimits, 'features'>;
export type FeatureKey =
  | 'analytics' | 'automation' | 'ivr' | 'webhooks'
  | 'api_access' | 'call_recording' | 'custom_branding'
  | 'priority_support' | 'sso';

// ── In-memory cache ───────────────────────────────────────────────────────────
// Plans change rarely; cache for 5 minutes to avoid extra DB round-trips.

const limitCache = new Map<number, { limits: PlanLimits; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(tenantId: number): PlanLimits | null {
  const entry = limitCache.get(tenantId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.limits;
}

function setCache(tenantId: number, limits: PlanLimits): void {
  limitCache.set(tenantId, { limits, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateLimitCache(tenantId: number): void {
  limitCache.delete(tenantId);
}

// ── Core service ──────────────────────────────────────────────────────────────

export class PlansService {
  // ── Limit resolution ───────────────────────────────────────────────────────

  /**
   * Fetch effective limits for a tenant (plan + per-tenant overrides).
   * Uses the DB function get_tenant_limits() which merges plan + overrides.
   */
  async getEffectiveLimits(tenantId: number): Promise<PlanLimits> {
    const cached = getCached(tenantId);
    if (cached) return cached;

    const { data, error } = await serviceRoleClient.rpc('get_tenant_limits', {
      p_tenant_id: tenantId,
    });

    if (error || !data) {
      logger.error({ error, tenantId }, 'Failed to fetch tenant limits, falling back to free plan');
      // Hard-coded free-tier fallback — never block a request on our infra failure
      return {
        max_users: 2,
        max_contacts: 500,
        max_whatsapp_accounts: 1,
        max_campaigns: 3,
        max_api_keys: 1,
        rate_limit_per_minute: 30,
        max_campaign_recipients: 100,
        max_message_templates: 3,
        features: {
          analytics: false, automation: false, ivr: false,
          webhooks: false, api_access: false, call_recording: false,
          custom_branding: false, priority_support: false, sso: false,
        },
      };
    }

    const limits = data as PlanLimits;
    setCache(tenantId, limits);
    return limits;
  }

  /**
   * Assert tenant has not hit a specific resource limit.
   * Throws 429 PLAN_LIMIT_EXCEEDED if over limit.
   */
  async assertWithinLimit(
    tenantId: number,
    limitKey: LimitKey,
    currentCount: number,
    resourceLabel: string,
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(tenantId);
    const max = limits[limitKey];

    if (currentCount >= max) {
      throw new AppError(
        `${resourceLabel} limit reached (${currentCount}/${max}). Upgrade your plan to add more.`,
        429,
        'PLAN_LIMIT_EXCEEDED',
      );
    }
  }

  /**
   * Assert a feature flag is enabled for this tenant's plan.
   * Throws 403 FEATURE_NOT_AVAILABLE if flag is false.
   */
  async assertFeatureEnabled(tenantId: number, feature: FeatureKey): Promise<void> {
    const limits = await this.getEffectiveLimits(tenantId);
    if (!limits.features[feature]) {
      throw new AppError(
        `The "${feature}" feature is not available on your current plan. Please upgrade.`,
        403,
        'FEATURE_NOT_AVAILABLE',
      );
    }
  }

  // ── Count helpers ──────────────────────────────────────────────────────────
  // Lean COUNT queries — never load full rows just to count.

  async countUsers(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (error) throw error;
    return count ?? 0;
  }

  async countContacts(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    if (error) throw error;
    return count ?? 0;
  }

  async countWhatsAppAccounts(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (error) throw error;
    return count ?? 0;
  }

  async countCampaigns(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return count ?? 0;
  }

  async countApiKeys(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (error) throw error;
    return count ?? 0;
  }

  async countMessageTemplates(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('message_templates')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if (error) throw error;
    return count ?? 0;
  }

  // ── Plan management (admin only) ───────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []) as Plan[];
  }

  async getPlanById(id: number): Promise<Plan> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new AppError('Plan not found', 404, 'NOT_FOUND');
    return data as Plan;
  }

  async createPlan(input: Omit<Plan, 'id' | 'is_active'> & { is_active?: boolean }): Promise<Plan> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .insert({ ...input, is_active: input.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return data as Plan;
  }

  async updatePlan(id: number, input: Partial<Plan>): Promise<Plan> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new AppError('Plan not found', 404, 'NOT_FOUND');
    // Invalidate all cached limits since plan changed
    limitCache.clear();
    return data as Plan;
  }

  async assignPlanToTenant(
    tenantId: number,
    planId: number,
    options: {
      billingCycle?: 'monthly' | 'yearly';
      limitOverrides?: Partial<PlanLimits>;
      trialDays?: number;
    } = {}
  ): Promise<void> {
    const plan = await this.getPlanById(planId);

    const trialEndsAt = options.trialDays
      ? new Date(Date.now() + options.trialDays * 86400000).toISOString()
      : null;

    // Cancel existing active subscription
    await serviceRoleClient
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('status', ['trialing', 'active']);

    // Insert new subscription
    const { error } = await serviceRoleClient
      .from('tenant_subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id: planId,
        billing_cycle: options.billingCycle ?? 'monthly',
        status: trialEndsAt ? 'trialing' : 'active',
        trial_ends_at: trialEndsAt,
        current_period_start: new Date().toISOString(),
        limit_overrides: options.limitOverrides
          ? JSON.stringify(options.limitOverrides)
          : '{}',
      });

    if (error) throw error;

    // Update the denormalized plan column on tenants
    await serviceRoleClient
      .from('tenants')
      .update({ plan_id: planId, plan: plan.name as any, updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    invalidateLimitCache(tenantId);

    logger.info({ tenantId, planId, planName: plan.name }, 'Plan assigned to tenant');
  }

  async updateTenantLimitOverrides(
    tenantId: number,
    overrides: Partial<PlanLimits>,
  ): Promise<void> {
    const { error } = await serviceRoleClient
      .from('tenant_subscriptions')
      .update({ limit_overrides: overrides, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('status', ['trialing', 'active']);

    if (error) throw error;
    invalidateLimitCache(tenantId);
  }
}

export const plansService = new PlansService();