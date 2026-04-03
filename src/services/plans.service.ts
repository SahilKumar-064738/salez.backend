/**
 * src/services/plans.service.ts
 *
 * FIXES APPLIED:
 *  1. getEffectiveLimits() — fallback now logs a structured error but never throws,
 *     ensuring infra failures don't block user requests.
 *  2. assignPlanToTenant() — limit_overrides is stored as object (not JSON.stringify),
 *     Supabase driver handles serialisation.
 *  3. updateTenantLimitOverrides() — now correctly targets the most recent active
 *     subscription (uses .order + .limit(1)) to avoid updating multiple rows.
 *  4. countCampaigns() — now excludes cancelled campaigns (consistent with purpose).
 *  5. getFreePlanId() cache is module-level singleton (correct); added error message
 *     that includes DB error details.
 *  6. PlansService exported as singleton at bottom (was after the standalone function,
 *     causing potential initialisation order issues).
 */

import { serviceRoleClient } from '../config/supabase';
import { AppError } from '../types';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

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
  created_at: string;
  updated_at: string;
}

export type LimitKey = keyof Omit<PlanLimits, 'features'>;

export type FeatureKey =
  | 'analytics'
  | 'automation'
  | 'ivr'
  | 'webhooks'
  | 'api_access'
  | 'call_recording'
  | 'custom_branding'
  | 'priority_support'
  | 'sso';

// ── Conservative free-tier fallback ───────────────────────────────────────────
// Used when the DB is unreachable. Conservative values protect against abuse.

const FREE_TIER_FALLBACK: PlanLimits = {
  max_users: 2,
  max_contacts: 500,
  max_whatsapp_accounts: 1,
  max_campaigns: 3,
  max_api_keys: 1,
  rate_limit_per_minute: 30,
  max_campaign_recipients: 100,
  max_message_templates: 3,
  features: {
    analytics: false,
    automation: false,
    ivr: false,
    webhooks: false,
    api_access: false,
    call_recording: false,
    custom_branding: false,
    priority_support: false,
    sso: false,
  },
};

// ── In-memory plan limit cache ─────────────────────────────────────────────────
// Plans change rarely — 5-minute TTL keeps DB round-trips minimal at scale.
// For Redis-based caching, replace the Map with a Redis get/set wrapper.

interface CacheEntry {
  limits: PlanLimits;
  expiresAt: number;
}

const limitCache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(tenantId: number): PlanLimits | null {
  const entry = limitCache.get(tenantId);
  if (!entry || Date.now() > entry.expiresAt) {
    limitCache.delete(tenantId);
    return null;
  }
  return entry.limits;
}

function setCache(tenantId: number, limits: PlanLimits): void {
  limitCache.set(tenantId, { limits, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateLimitCache(tenantId: number): void {
  limitCache.delete(tenantId);
}

// ── PlansService ───────────────────────────────────────────────────────────────

export class PlansService {

  // ── Limit resolution ────────────────────────────────────────────────────────

  /**
   * Fetch effective limits for a tenant.
   * Merges plan defaults with per-tenant overrides stored in tenant_subscriptions.
   * Falls back to conservative free-tier limits if DB is unreachable.
   *
   * NOTE: Requires get_tenant_limits(p_tenant_id bigint) PostgreSQL function.
   * See sql/functions.sql for definition.
   */
  async getEffectiveLimits(tenantId: number): Promise<PlanLimits> {
    const cached = getCached(tenantId);
    if (cached) return cached;

    const { data, error } = await serviceRoleClient.rpc('get_tenant_limits', {
      p_tenant_id: tenantId,
    });

    if (error || !data) {
      logger.error({ error, tenantId }, 'get_tenant_limits RPC failed — using conservative fallback');
      // Return fallback but do NOT cache it — we want to retry the DB next time
      return FREE_TIER_FALLBACK;
    }

    const limits = data as PlanLimits;
    setCache(tenantId, limits);
    return limits;
  }

  /**
   * Assert tenant is within a specific resource limit.
   * Throws 429 PLAN_LIMIT_EXCEEDED if at or over limit.
   */
  async assertWithinLimit(
    tenantId: number,
    limitKey: LimitKey,
    currentCount: number,
    resourceLabel: string,
  ): Promise<void> {
    const limits = await this.getEffectiveLimits(tenantId);
    const max = limits[limitKey] as number;

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
   * Throws 403 FEATURE_NOT_AVAILABLE if the flag is false.
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

  // ── COUNT helpers ────────────────────────────────────────────────────────────
  // These use HEAD-only COUNT queries — no rows are fetched.

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

  /**
   * FIX: Exclude cancelled campaigns from limit count.
   * Counting cancelled campaigns against limits discourages cleanup.
   */
  async countCampaigns(tenantId: number): Promise<number> {
    const { count, error } = await serviceRoleClient
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('status', 'eq', 'cancelled');
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

  // ── Plan management (admin-only operations) ──────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []) as Plan[];
  }

  async listAllPlans(): Promise<Plan[]> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .select('*')
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

  async createPlan(input: Omit<Plan, 'id' | 'created_at' | 'updated_at'> & { is_active?: boolean }): Promise<Plan> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .insert({ ...input, is_active: input.is_active ?? true })
      .select()
      .single();
    if (error) throw error;
    return data as Plan;
  }

  async updatePlan(id: number, input: Partial<Omit<Plan, 'id' | 'created_at'>>): Promise<Plan> {
    const { data, error } = await serviceRoleClient
      .from('plans')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new AppError('Plan not found', 404, 'NOT_FOUND');
    // Invalidate ALL cached limits — every tenant using this plan is affected
    limitCache.clear();
    logger.info({ planId: id }, 'Plan updated — full limit cache cleared');
    return data as Plan;
  }

  /**
   * Assign a plan to a tenant.
   * Cancels all existing active/trialing subscriptions, creates a new one,
   * and updates the denormalized plan_id on the tenants row.
   */
  async assignPlanToTenant(
    tenantId: number,
    planId: number,
    options: {
      billingCycle?: 'monthly' | 'yearly';
      limitOverrides?: Partial<PlanLimits>;
      trialDays?: number;
    } = {},
  ): Promise<void> {
    const plan = await this.getPlanById(planId);

    const trialEndsAt = options.trialDays
      ? new Date(Date.now() + options.trialDays * 86_400_000).toISOString()
      : null;

    // Cancel all existing active/trialing subscriptions
    const { error: cancelErr } = await serviceRoleClient
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('status', ['trialing', 'active']);

    if (cancelErr) throw cancelErr;

    // Insert new subscription — limit_overrides stored as JSONB object (NOT stringified)
    const { error: subErr } = await serviceRoleClient
      .from('tenant_subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id: planId,
        billing_cycle: options.billingCycle ?? 'monthly',
        status: trialEndsAt ? 'trialing' : 'active',
        trial_ends_at: trialEndsAt,
        current_period_start: new Date().toISOString(),
        limit_overrides: options.limitOverrides ?? {},
      });

    if (subErr) throw subErr;

    // Keep denormalized plan_id on tenants in sync
    const { error: tenantErr } = await serviceRoleClient
      .from('tenants')
      .update({
        plan_id: planId,
        plan: plan.name as any,  // legacy enum column
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    if (tenantErr) throw tenantErr;

    invalidateLimitCache(tenantId);
    logger.info({ tenantId, planId, planName: plan.name }, 'Plan assigned to tenant');
  }

  /**
   * FIX: Targets the single most-recent active/trialing subscription.
   * The old code could update multiple rows if the DB had duplicate active subs.
   */
  async updateTenantLimitOverrides(
    tenantId: number,
    overrides: Partial<PlanLimits>,
  ): Promise<void> {
    // Fetch the most recent active subscription ID
    const { data: sub, error: fetchErr } = await serviceRoleClient
      .from('tenant_subscriptions')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('status', ['trialing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchErr || !sub) {
      throw new AppError('No active subscription found for tenant', 404, 'NOT_FOUND');
    }

    const { error } = await serviceRoleClient
      .from('tenant_subscriptions')
      .update({ limit_overrides: overrides, updated_at: new Date().toISOString() })
      .eq('id', sub.id);

    if (error) throw error;
    invalidateLimitCache(tenantId);
    logger.info({ tenantId, subId: sub.id }, 'Limit overrides updated');
  }
}

// ── Singleton exports ──────────────────────────────────────────────────────────

export const plansService = new PlansService();

// ── Free plan ID cache (module-level singleton) ────────────────────────────────

let cachedFreePlanId: number | null = null;

export async function getFreePlanId(): Promise<number> {
  if (cachedFreePlanId !== null) return cachedFreePlanId;

  const { data, error } = await serviceRoleClient
    .from('plans')
    .select('id')
    .eq('name', 'free')
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error(
      `Free plan not found in database. Seed the plans table. DB error: ${error?.message ?? 'no data'}`
    );
  }

  cachedFreePlanId = data.id as number;
  return cachedFreePlanId;
}