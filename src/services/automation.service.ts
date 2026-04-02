/**
 * src/services/automation.service.ts — FIXED
 *
 * CHANGE: Fixed import path for setTenantContextForWorker.
 * Was:    '../middleware/tenantContext'         (WRONG — no such path)
 * Now:    '../middlewares/tenantContext.middleware'  (CORRECT)
 *
 * All other logic preserved exactly.
 */

import { serviceRoleClient } from '../config/supabase';
import { sendMessageQueue }  from '../queues';
import { logger }            from '../utils/logger';
import { setTenantContextForWorker } from '../middlewares/tenantContext.middleware'; // ← FIXED

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutomationRule {
  id: number;
  tenant_id: number;
  name: string;
  trigger_type: TriggerType;
  conditions: Record<string, unknown>;
  actions: AutomationAction[];
  is_active: boolean;
}

export type TriggerType =
  | 'inbound_message'
  | 'call_ended'
  | 'contact_stage_changed'
  | 'schedule';

export interface AutomationAction {
  type: ActionType;
  template_id?: number;
  content?: string;
  delay_minutes?: number;
  stage?: string;
  tag?: string;
  url?: string;
  message?: string;
}

export type ActionType =
  | 'send_whatsapp'
  | 'send_whatsapp_text'
  | 'update_contact_stage'
  | 'create_scheduled_call'
  | 'add_tag'
  | 'notify_webhook';

export interface TriggerContext {
  tenantId: number;
  contactId?: number;
  callId?: string;
  messageContent?: string;
  previousStage?: string;
  newStage?: string;
  metadata?: Record<string, unknown>;
}

// ── AutomationService ─────────────────────────────────────────────────────────

export class AutomationService {
  /**
   * Evaluate and fire all matching automation rules for a given trigger.
   * Sets tenant context before any DB access so RLS activates.
   */
  async evaluate(trigger: TriggerType, ctx: TriggerContext): Promise<void> {
    const { tenantId } = ctx;

    // CRITICAL: set tenant context before querying automation_rules
    await setTenantContextForWorker(tenantId);

    const { data: rules, error } = await serviceRoleClient
      .from('automation_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('trigger_type', trigger)
      .eq('is_active', true);

    if (error) {
      logger.error({ error, tenantId, trigger }, 'Failed to load automation rules');
      return;
    }

    for (const rule of (rules ?? []) as AutomationRule[]) {
      if (this._matchesConditions(rule.conditions, ctx)) {
        await this._executeActions(rule, ctx);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _matchesConditions(
    conditions: Record<string, unknown>,
    ctx: TriggerContext
  ): boolean {
    // Empty conditions = always matches
    if (!conditions || Object.keys(conditions).length === 0) return true;

    // Stage filter
    if (conditions.stage && ctx.newStage !== conditions.stage) return false;

    // Contact tag filter (would need a DB call — skip for now, return true)
    // Extend here with specific condition types as needed

    return true;
  }

  private async _executeActions(rule: AutomationRule, ctx: TriggerContext): Promise<void> {
    for (const action of rule.actions) {
      try {
        await this._executeAction(action, rule, ctx);
      } catch (err) {
        logger.error({ err, ruleId: rule.id, actionType: action.type }, 'Automation action failed');
        // Continue executing remaining actions — one failure must not block others
      }
    }
  }

  private async _executeAction(
    action: AutomationAction,
    rule: AutomationRule,
    ctx: TriggerContext
  ): Promise<void> {
    const { tenantId, contactId } = ctx;

    switch (action.type) {
      case 'send_whatsapp': {
        if (!contactId || !action.template_id) break;

        // Load template
        const { data: template } = await serviceRoleClient
          .from('message_templates')
          .select('content')
          .eq('id', action.template_id)
          .eq('tenant_id', tenantId)
          .single();

        if (!template) {
          logger.warn({ ruleId: rule.id, templateId: action.template_id }, 'Template not found');
          break;
        }

        // Get default whatsapp account for tenant
        const { data: waAccount } = await serviceRoleClient
          .from('whatsapp_accounts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (!waAccount) {
          logger.warn({ tenantId }, 'No active WhatsApp account for automation');
          break;
        }

        const delayMs = (action.delay_minutes ?? 0) * 60_000;

        await sendMessageQueue.add(
          'send-message',
          {
            tenantId,
            contactId,
            whatsappAccountId: waAccount.id,
            content: template.content,
          },
          { delay: delayMs }
        );
        break;
      }

      case 'send_whatsapp_text': {
        if (!contactId || !action.content) break;

        const { data: waAccount } = await serviceRoleClient
          .from('whatsapp_accounts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (!waAccount) break;

        const delayMs = (action.delay_minutes ?? 0) * 60_000;

        await sendMessageQueue.add(
          'send-message',
          { tenantId, contactId, whatsappAccountId: waAccount.id, content: action.content },
          { delay: delayMs }
        );
        break;
      }

      case 'update_contact_stage': {
        if (!contactId || !action.stage) break;
        await serviceRoleClient
          .from('contacts')
          .update({ stage: action.stage, updated_at: new Date().toISOString() })
          .eq('id', contactId)
          .eq('tenant_id', tenantId);
        break;
      }

      case 'add_tag': {
        if (!contactId || !action.tag) break;
        // Upsert: ignore conflict if tag already exists
        await serviceRoleClient
          .from('contact_tags')
          .upsert(
            { tenant_id: tenantId, contact_id: contactId, tag: action.tag },
            { onConflict: 'tenant_id,contact_id,tag', ignoreDuplicates: true }
          );
        break;
      }

      case 'create_scheduled_call': {
        const runAt = new Date(Date.now() + (action.delay_minutes ?? 0) * 60_000);
        await serviceRoleClient
          .from('scheduled_jobs')
          .insert({
            tenant_id: tenantId,
            job_type:  'schedule_call',
            payload:   { contact_id: contactId, message: action.message ?? '' },
            run_at:    runAt.toISOString(),
            status:    'pending',
          });
        break;
      }

      case 'notify_webhook': {
        if (!action.url) break;
        // Fire-and-forget — don't block automation for webhook delivery
        fetch(action.url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ trigger: rule.trigger_type, tenantId, contactId, ...ctx.metadata }),
        }).catch((err) => logger.warn({ err, url: action.url }, 'Webhook notification failed'));
        break;
      }

      default:
        logger.warn({ actionType: action.type, ruleId: rule.id }, 'Unknown automation action type');
    }
  }
}

export const automationService = new AutomationService();