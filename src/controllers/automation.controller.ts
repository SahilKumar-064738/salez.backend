/**
 * src/controllers/automation.controller.ts
 *
 * CRUD controller for automation_rules.
 * All routes are tenant-scoped via tenantContextMiddleware (applied in routes/index.ts).
 */

import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';
import { logger } from '../utils/logger';

// ── Schemas ────────────────────────────────────────────────────────────────────

const AutomationActionSchema = z.object({
  type: z.enum([
    'send_whatsapp',
    'send_whatsapp_text',
    'update_contact_stage',
    'create_scheduled_call',
    'add_tag',
    'notify_webhook',
  ]),
  template_id:    z.number().int().positive().optional(),
  content:        z.string().max(4096).optional(),
  delay_minutes:  z.number().int().min(0).max(43200).optional(), // max 30 days
  stage:          z.string().max(50).optional(),
  tag:            z.string().max(64).optional(),
  url:            z.string().url().optional(),
  message:        z.string().max(2000).optional(),
});

const CreateRuleSchema = z.object({
  name:         z.string().min(1).max(200),
  trigger_type: z.enum(['inbound_message', 'call_ended', 'contact_stage_changed', 'schedule']),
  conditions:   z.record(z.unknown()).default({}),
  actions:      z.array(AutomationActionSchema).min(1).max(20),
  is_active:    z.boolean().default(true),
});

const UpdateRuleSchema = CreateRuleSchema.partial();

// ── Controller ────────────────────────────────────────────────────────────────

class AutomationController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;

      const { data, error } = await serviceRoleClient
        .from('automation_rules')
        .select('id, name, trigger_type, conditions, actions, is_active, created_at, updated_at')
        .eq('tenant_id', tid)
        .order('created_at', { ascending: false });

      if (error) throw error;
      R.success(res, data, 'Automation rules retrieved');
    } catch (e) { next(e); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const id  = Number(req.params.id);

      const { data, error } = await serviceRoleClient
        .from('automation_rules')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tid)
        .single();

      if (error || !data) { R.notFound(res, 'Automation rule not found'); return; }
      R.success(res, data);
    } catch (e) { next(e); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r    = req as AuthenticatedRequest;
      const tid  = r.user.tenantId;
      const body = CreateRuleSchema.parse(req.body);

      const { data, error } = await serviceRoleClient
        .from('automation_rules')
        .insert({
          tenant_id:    tid,
          created_by:   r.user.id,
          name:         body.name,
          trigger_type: body.trigger_type,
          conditions:   body.conditions,
          actions:      body.actions,
          is_active:    body.is_active,
        })
        .select()
        .single();

      if (error) throw error;
      logger.info({ tenantId: tid, ruleId: data.id }, 'Automation rule created');
      R.created(res, data, 'Automation rule created');
    } catch (e) { next(e); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r    = req as AuthenticatedRequest;
      const tid  = r.user.tenantId;
      const id   = Number(req.params.id);
      const body = UpdateRuleSchema.parse(req.body);

      const { data, error } = await serviceRoleClient
        .from('automation_rules')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tid)
        .select()
        .single();

      if (error || !data) { R.notFound(res, 'Automation rule not found'); return; }
      R.success(res, data, 'Automation rule updated');
    } catch (e) { next(e); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const id  = Number(req.params.id);

      const { error } = await serviceRoleClient
        .from('automation_rules')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tid);

      if (error) throw error;
      R.success(res, null, 'Automation rule deleted');
    } catch (e) { next(e); }
  }

  async toggle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const id  = Number(req.params.id);

      // Fetch current state
      const { data: existing } = await serviceRoleClient
        .from('automation_rules')
        .select('is_active')
        .eq('id', id)
        .eq('tenant_id', tid)
        .single();

      if (!existing) { R.notFound(res, 'Automation rule not found'); return; }

      const { data, error } = await serviceRoleClient
        .from('automation_rules')
        .update({ is_active: !existing.is_active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tid)
        .select()
        .single();

      if (error) throw error;
      R.success(res, data, `Automation rule ${data.is_active ? 'enabled' : 'disabled'}`);
    } catch (e) { next(e); }
  }
}

export const automationController = new AutomationController();