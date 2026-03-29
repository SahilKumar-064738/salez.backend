import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';

const DateRangeSchema = z.object({
  from_date: z.string().datetime({ offset: true }).default(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  ),
  to_date: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  group_by: z.enum(['day', 'week', 'month']).optional(),
});

const ApiUsageSchema = z.object({
  from_date: z.string().datetime({ offset: true }).default(
    () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  ),
  to_date: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  api_key_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export class AnalyticsController {
  /**
   * GET /analytics/calls
   * Aggregated call metrics: totals, status breakdown, duration, cost,
   * average MOS score, and average total latency — all in one query set.
   * Queries parent (partitioned) `calls` and `call_metrics` tables.
   */
  async getCallAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = DateRangeSchema.parse(req.query);

      // Fetch all calls in range — uses partitioned `calls` parent table
      const { data: calls, error: callErr } = await serviceRoleClient
        .from('calls')
        .select('id, status, direction, duration_seconds, cost, started_at')
        .eq('tenant_id', user.tenantId)
        .gte('started_at', q.from_date)
        .lte('started_at', q.to_date);

      if (callErr) throw callErr;
      const rows = calls ?? [];

      // Fetch quality metrics for all call IDs in one query
      const callIds = rows.map((r) => r.id);
      let avgMos: number | null = null;
      let avgSttLatency: number | null = null;
      let avgLlmLatency: number | null = null;
      let avgTtsLatency: number | null = null;
      let avgTotalLatency: number | null = null;

      if (callIds.length > 0) {
        const { data: metrics } = await serviceRoleClient
          .from('call_metrics')
          .select('mos_score, stt_latency_ms, llm_latency_ms, tts_latency_ms, total_latency_ms')
          .eq('tenant_id', user.tenantId)
          .in('call_id', callIds);

        if (metrics && metrics.length > 0) {
          const avg = (arr: (number | null)[]): number | null => {
            const valid = arr.filter((v): v is number => v != null);
            return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
          };
          avgMos          = avg(metrics.map((m) => m.mos_score));
          avgSttLatency   = avg(metrics.map((m) => m.stt_latency_ms));
          avgLlmLatency   = avg(metrics.map((m) => m.llm_latency_ms));
          avgTtsLatency   = avg(metrics.map((m) => m.tts_latency_ms));
          avgTotalLatency = avg(metrics.map((m) => m.total_latency_ms));
        }
      }

      const completed  = rows.filter((r) => r.status === 'completed');
      const totalDur   = completed.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);
      const totalCost  = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);

      const round2 = (n: number | null) => n !== null ? Math.round(n * 100) / 100 : null;

      const summary = {
        period: { from_date: q.from_date, to_date: q.to_date },
        totals: {
          calls:              rows.length,
          completed:          completed.length,
          failed:             rows.filter((r) => r.status === 'failed').length,
          no_answer:          rows.filter((r) => r.status === 'no-answer').length,
          busy:               rows.filter((r) => r.status === 'busy').length,
          cancelled:          rows.filter((r) => r.status === 'cancelled').length,
          inbound:            rows.filter((r) => r.direction === 'inbound').length,
          outbound:           rows.filter((r) => r.direction === 'outbound').length,
        },
        duration: {
          total_seconds:      totalDur,
          avg_seconds:        completed.length > 0 ? Math.round(totalDur / completed.length) : 0,
        },
        cost: {
          total:              round2(totalCost),
          avg_per_call:       rows.length > 0 ? round2(totalCost / rows.length) : 0,
        },
        quality: {
          avg_mos_score:      round2(avgMos),
          avg_stt_latency_ms: round2(avgSttLatency),
          avg_llm_latency_ms: round2(avgLlmLatency),
          avg_tts_latency_ms: round2(avgTtsLatency),
          avg_total_latency_ms: round2(avgTotalLatency),
        },
      };

      R.success(res, summary);
    } catch (e) { next(e); }
  }

  /**
   * GET /analytics/latency
   * STT / LLM / TTS latency breakdown per call, with aggregates.
   * Queries the (non-partitioned) `call_metrics` table directly.
   */
  async getLatencyBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = DateRangeSchema.parse(req.query);

      // Get all calls in range to filter metrics by date
      const { data: calls, error: callErr } = await serviceRoleClient
        .from('calls')
        .select('id')
        .eq('tenant_id', user.tenantId)
        .gte('started_at', q.from_date)
        .lte('started_at', q.to_date);

      if (callErr) throw callErr;
      const callIds = (calls ?? []).map((c) => c.id);

      if (callIds.length === 0) {
        return R.success(res, { items: [], aggregates: null });
      }

      const { data: metrics, error: metErr } = await serviceRoleClient
        .from('call_metrics')
        .select('call_id, stt_latency_ms, llm_latency_ms, tts_latency_ms, total_latency_ms, mos_score, recorded_at')
        .eq('tenant_id', user.tenantId)
        .in('call_id', callIds)
        .order('recorded_at', { ascending: false });

      if (metErr) throw metErr;
      const rows = metrics ?? [];

      // Compute percentile helpers
      const pct = (arr: number[], p: number) => {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.floor((p / 100) * sorted.length);
        return sorted[Math.min(idx, sorted.length - 1)];
      };

      const totalLatencies = rows.map((r) => r.total_latency_ms).filter((v): v is number => v != null);
      const mosScores      = rows.map((r) => r.mos_score).filter((v): v is number => v != null);
      const sttArr         = rows.map((r) => r.stt_latency_ms).filter((v): v is number => v != null);
      const llmArr         = rows.map((r) => r.llm_latency_ms).filter((v): v is number => v != null);
      const ttsArr         = rows.map((r) => r.tts_latency_ms).filter((v): v is number => v != null);

      const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

      R.success(res, {
        items: rows,
        aggregates: {
          sample_size:         rows.length,
          stt_latency_ms:      { avg: avg(sttArr),  p50: pct(sttArr, 50),  p95: pct(sttArr, 95),  p99: pct(sttArr, 99)  },
          llm_latency_ms:      { avg: avg(llmArr),  p50: pct(llmArr, 50), p95: pct(llmArr, 95), p99: pct(llmArr, 99) },
          tts_latency_ms:      { avg: avg(ttsArr),  p50: pct(ttsArr, 50), p95: pct(ttsArr, 95), p99: pct(ttsArr, 99) },
          total_latency_ms:    { avg: avg(totalLatencies), p50: pct(totalLatencies, 50), p95: pct(totalLatencies, 95), p99: pct(totalLatencies, 99) },
          avg_mos_score:       mosScores.length > 0 ? Math.round((mosScores.reduce((a, b) => a + b, 0) / mosScores.length) * 100) / 100 : null,
        },
      });
    } catch (e) { next(e); }
  }

  /**
   * GET /analytics/api-usage
   * API log summary: request counts, error rates, avg response times.
   * Queries the partitioned `api_logs` parent table (PG auto-selects partitions).
   * Scoped strictly to the authenticated tenant.
   */
  async getApiUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = ApiUsageSchema.parse(req.query);

      let query = serviceRoleClient
        .from('api_logs')
        .select('endpoint, method, status_code, response_time_ms, api_key_id, created_at')
        .eq('tenant_id', user.tenantId)
        .gte('created_at', q.from_date)
        .lte('created_at', q.to_date)
        .order('created_at', { ascending: false })
        .limit(q.limit);

      if (q.api_key_id) query = query.eq('api_key_id', q.api_key_id);

      const { data, error } = await query;
      if (error) throw error;

      const rows = data ?? [];

      // Group by endpoint + method
      const byEndpoint: Record<string, { count: number; errors: number; total_ms: number }> = {};
      for (const row of rows) {
        const key = `${row.method} ${row.endpoint}`;
        if (!byEndpoint[key]) byEndpoint[key] = { count: 0, errors: 0, total_ms: 0 };
        byEndpoint[key].count++;
        if (row.status_code >= 400) byEndpoint[key].errors++;
        byEndpoint[key].total_ms += row.response_time_ms ?? 0;
      }

      const endpointBreakdown = Object.entries(byEndpoint).map(([endpoint, v]) => ({
        endpoint,
        requests:       v.count,
        errors:         v.errors,
        error_rate:     Math.round((v.errors / v.count) * 100 * 100) / 100,
        avg_response_ms: Math.round(v.total_ms / v.count),
      })).sort((a, b) => b.requests - a.requests);

      const totalRequests = rows.length;
      const totalErrors   = rows.filter((r) => r.status_code >= 400).length;
      const validMs       = rows.map((r) => r.response_time_ms).filter((v): v is number => v != null);
      const avgMs         = validMs.length > 0 ? Math.round(validMs.reduce((a, b) => a + b, 0) / validMs.length) : null;

      R.success(res, {
        period:          { from_date: q.from_date, to_date: q.to_date },
        summary: {
          total_requests: totalRequests,
          total_errors:   totalErrors,
          error_rate:     totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 100 * 100) / 100 : 0,
          avg_response_ms: avgMs,
          status_codes:   rows.reduce<Record<number, number>>((acc, r) => {
            acc[r.status_code] = (acc[r.status_code] ?? 0) + 1;
            return acc;
          }, {}),
        },
        endpoints: endpointBreakdown,
        logs:      rows,
      });
    } catch (e) { next(e); }
  }
}

export const analyticsController = new AnalyticsController();