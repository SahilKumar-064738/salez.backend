// src/controllers/plans.controller.ts
// ─────────────────────────────────────────────────────────────────────────────
// Admin-only controller for plan CRUD and tenant plan assignment.
// Mount under /api/v1/admin/plans — protected by adminAuth middleware.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { plansService } from '../services/plans.service';
import * as R from '../utils/response';
import { AppError } from '../types';
import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreatePlanSchema = z.object({
  name: z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/),
  display_name: z.string().min(1).max(100),
  price_monthly: z.number().min(0).default(0),
  price_yearly: z.number().min(0).default(0),
  stripe_price_id_monthly: z.string().optional().nullable(),
  stripe_price_id_yearly: z.string().optional().nullable(),
  max_users: z.number().int().min(1).default(5),
  max_contacts: z.number().int().min(0).default(1000),
  max_whatsapp_accounts: z.number().int().min(1).default(1),
  max_campaigns: z.number().int().min(0).default(10),
  max_api_keys: z.number().int().min(0).default(3),
  rate_limit_per_minute: z.number().int().min(1).default(60),
  max_campaign_recipients: z.number().int().min(1).default(500),
  max_message_templates: z.number().int().min(1).default(5),
  features: z.record(z.boolean()).optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

const AssignPlanSchema = z.object({
  planId: z.number().int().positive(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  limitOverrides: z.record(z.number()).optional(),
});

const OverrideSchema = z.object({
  overrides: z.record(z.number()),
});

// ── Controller ────────────────────────────────────────────────────────────────

export class PlansController {
  /** GET /admin/plans — list all plans */
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const plans = await plansService.listPlans();
      R.success(res, plans);
    } catch (err) { next(err); }
  }

  /** GET /admin/plans/:id */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid plan ID', 400, 'INVALID_PARAM');
      const plan = await plansService.getPlanById(id);
      R.success(res, plan);
    } catch (err) { next(err); }
  }

  /** POST /admin/plans */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = CreatePlanSchema.parse(req.body);
      const plan = await plansService.createPlan(body as any);
      R.created(res, plan, 'Plan created');
    } catch (err) { next(err); }
  }

  /** PATCH /admin/plans/:id */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid plan ID', 400, 'INVALID_PARAM');
      const body = CreatePlanSchema.partial().parse(req.body);
      const plan = await plansService.updatePlan(id, body as any);
      R.success(res, plan, 'Plan updated');
    } catch (err) { next(err); }
  }

  /** POST /admin/tenants/:tenantId/plan — assign plan to tenant */
  async assignToTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) throw new AppError('Invalid tenant ID', 400, 'INVALID_PARAM');
      const { planId, billingCycle, trialDays, limitOverrides } = AssignPlanSchema.parse(req.body);

      await plansService.assignPlanToTenant(tenantId, planId, {
        billingCycle,
        trialDays,
        limitOverrides: limitOverrides as any,
      });

      R.success(res, null, 'Plan assigned to tenant successfully');
    } catch (err) { next(err); }
  }

  /** PATCH /admin/tenants/:tenantId/plan/overrides — per-tenant limit overrides */
  async updateOverrides(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) throw new AppError('Invalid tenant ID', 400, 'INVALID_PARAM');
      const { overrides } = OverrideSchema.parse(req.body);
      await plansService.updateTenantLimitOverrides(tenantId, overrides as any);
      R.success(res, null, 'Limit overrides updated');
    } catch (err) { next(err); }
  }

  /** GET /admin/tenants/:tenantId/plan/limits — inspect effective limits */
  async getTenantLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) throw new AppError('Invalid tenant ID', 400, 'INVALID_PARAM');
      const limits = await plansService.getEffectiveLimits(tenantId);
      R.success(res, limits);
    } catch (err) { next(err); }
  }

  /** GET /settings/plan — current tenant's plan + limits (non-admin) */
  async getMyPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = (req as any).user.tenantId as number;
      const limits = await plansService.getEffectiveLimits(tenantId);
      R.success(res, limits);
    } catch (err) { next(err); }
  }
}

export const plansController = new PlansController();