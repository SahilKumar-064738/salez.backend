/**
 * src/controllers/analytics.controller.ts — COMPLETE
 *
 * ADDITIONS vs compiled dist (which only had getCallAnalytics, getLatencyBreakdown, getApiUsage):
 *   - getMessageAnalytics (GET /analytics/messages) — was listed in prompt but missing
 *   - getCampaignAnalytics (GET /analytics/campaigns) — needed by frontend AnalyticsPage
 *
 * All existing methods preserved exactly.
 */

import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';

const DateRangeSchema = z.object({
  from_date: z.string().datetime({ offset: true }).default(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  ),
  to_date: z.string().datetime({ offset: true }).default(
    () => new Date().toISOString()
  ),
});

class AnalyticsController {
  // ── CALLS ──────────────────────────────────────────────────────────────────

  async getCallAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const q   = DateRangeSchema.parse(req.query);

      const { data, error } = await serviceRoleClient
        .from('calls')
        .select('status, direction, duration_seconds, started_at, cost')
        .eq('tenant_id', tid)
        .gte('started_at', q.from_date)
        .lte('started_at', q.to_date);

      if (error) throw error;

      const calls = data ?? [];
      const total        = calls.length;
      const completed    = calls.filter((c) => c.status === 'completed').length;
      const inbound      = calls.filter((c) => c.direction === 'inbound').length;
      const outbound     = calls.filter((c) => c.direction === 'outbound').length;
      const totalSeconds = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
      const avgDuration  = total > 0 ? Math.round(totalSeconds / total) : 0;
      const totalCost    = calls.reduce((s, c) => s + (Number(c.cost) ?? 0), 0);

      R.success(res, {
        total,
        completed,
        failed:         total - completed,
        inbound,
        outbound,
        avg_duration_s: avgDuration,
        total_cost_usd: Number(totalCost.toFixed(4)),
        period: { from: q.from_date, to: q.to_date },
      });
    } catch (e) { next(e); }
  }

  async getLatencyBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const q   = DateRangeSchema.parse(req.query);

      const { data, error } = await serviceRoleClient
        .from('call_metrics')
        .select('stt_latency_ms, llm_latency_ms, tts_latency_ms, total_latency_ms, mos_score, recorded_at')
        .eq('tenant_id', tid)
        .gte('recorded_at', q.from_date)
        .lte('recorded_at', q.to_date);

      if (error) throw error;

      const rows = data ?? [];
      const avg = (key: keyof typeof rows[0]) =>
        rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + (Number(r[key]) ?? 0), 0) / rows.length)
          : null;

      R.success(res, {
        sample_count:        rows.length,
        avg_stt_latency_ms:  avg('stt_latency_ms'),
        avg_llm_latency_ms:  avg('llm_latency_ms'),
        avg_tts_latency_ms:  avg('tts_latency_ms'),
        avg_total_latency_ms: avg('total_latency_ms'),
        avg_mos_score:       rows.length > 0
          ? Number((rows.reduce((s, r) => s + (Number(r.mos_score) ?? 0), 0) / rows.length).toFixed(2))
          : null,
        period: { from: q.from_date, to: q.to_date },
      });
    } catch (e) { next(e); }
  }

  async getApiUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const q   = DateRangeSchema.parse(req.query);

      const { data, error } = await serviceRoleClient
        .from('api_logs')
        .select('method, endpoint, status_code, response_time_ms, created_at')
        .eq('tenant_id', tid)
        .gte('created_at', q.from_date)
        .lte('created_at', q.to_date)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;

      const logs = data ?? [];
      const total     = logs.length;
      const errors    = logs.filter((l) => l.status_code >= 400).length;
      const avgResp   = total > 0
        ? Math.round(logs.reduce((s, l) => s + (l.response_time_ms ?? 0), 0) / total)
        : 0;

      // Group by endpoint
      const byEndpoint: Record<string, number> = {};
      for (const l of logs) {
        const key = `${l.method} ${l.endpoint}`;
        byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
      }

      R.success(res, {
        total_requests: total,
        error_count:    errors,
        error_rate:     total > 0 ? Number(((errors / total) * 100).toFixed(2)) : 0,
        avg_response_ms: avgResp,
        top_endpoints: Object.entries(byEndpoint)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([endpoint, count]) => ({ endpoint, count })),
        period: { from: q.from_date, to: q.to_date },
      });
    } catch (e) { next(e); }
  }

  // ── MESSAGES (was listed in spec but missing from dist) ────────────────────

  async getMessageAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const q   = DateRangeSchema.parse(req.query);

      const { data, error } = await serviceRoleClient
        .from('messages')
        .select('direction, status, sent_at, delivered_at, read_at')
        .eq('tenant_id', tid)
        .gte('sent_at', q.from_date)
        .lte('sent_at', q.to_date);

      if (error) throw error;

      const msgs   = data ?? [];
      const total  = msgs.length;
      const sent   = msgs.filter((m) => m.direction === 'outbound').length;
      const recv   = msgs.filter((m) => m.direction === 'inbound').length;
      const deliv  = msgs.filter((m) => m.delivered_at != null).length;
      const read   = msgs.filter((m) => m.read_at != null).length;
      const failed = msgs.filter((m) => m.status === 'failed').length;

      R.success(res, {
        total,
        sent,
        received:         recv,
        delivered:        deliv,
        read,
        failed,
        delivery_rate:    sent > 0 ? Number(((deliv / sent) * 100).toFixed(2)) : 0,
        read_rate:        deliv > 0 ? Number(((read / deliv) * 100).toFixed(2)) : 0,
        period: { from: q.from_date, to: q.to_date },
      });
    } catch (e) { next(e); }
  }

  // ── CAMPAIGNS ──────────────────────────────────────────────────────────────

  async getCampaignAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const r   = req as AuthenticatedRequest;
      const tid = r.user.tenantId;
      const q   = DateRangeSchema.parse(req.query);

      const { data, error } = await serviceRoleClient
        .from('campaigns')
        .select('id, name, status, total_recipients, sent_count, failed_count, started_at, completed_at')
        .eq('tenant_id', tid)
        .gte('created_at', q.from_date)
        .lte('created_at', q.to_date);

      if (error) throw error;

      const campaigns = data ?? [];
      const totalSent = campaigns.reduce((s, c) => s + c.sent_count, 0);
      const totalFail = campaigns.reduce((s, c) => s + c.failed_count, 0);

      R.success(res, {
        total_campaigns: campaigns.length,
        completed:       campaigns.filter((c) => c.status === 'completed').length,
        active:          campaigns.filter((c) => c.status === 'running').length,
        total_sent:      totalSent,
        total_failed:    totalFail,
        delivery_rate:   (totalSent + totalFail) > 0
          ? Number(((totalSent / (totalSent + totalFail)) * 100).toFixed(2))
          : 0,
        campaigns,
        period: { from: q.from_date, to: q.to_date },
      });
    } catch (e) { next(e); }
  }
}

export const analyticsController = new AnalyticsController();