/**
 * src/routes/ivr.routes.ts — UPDATED
 *
 * KEY CHANGE: tenantContextMiddleware applied immediately after apiKeyMiddleware.
 * The apiKeyMiddleware sets req.tenantId from the api_keys table.
 * The tenantContextMiddleware then calls set_tenant_context(tenantId) in PostgreSQL
 * so RLS policies activate for all subsequent DB queries in this request.
 *
 * Without this, the IVR would write call records, transcripts, metrics, and events
 * with the correct tenant_id column value, but RLS would still block those inserts
 * because app.tenant_id was never set in the DB session.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { apiKeyMiddleware }        from '../middlewares/apiKey.middleware';
import { tenantContextMiddleware } from '../middlewares/tenantContext.middleware';
import { callsRepository }         from '../repositories/calls.repository';
import { logger }                  from '../utils/logger';
import * as R                      from '../utils/response';

// ── Validation schemas ────────────────────────────────────────────────────────

const IvrStartCallSchema = z.object({
  id:           z.string().min(1).max(120),
  direction:    z.enum(['inbound', 'outbound']),
  from_number:  z.string().min(3).max(30),
  to_number:    z.string().min(3).max(30),
  status:       z.enum(['initiated', 'ringing', 'in-progress']).optional(),
  ivr_flow_id:  z.string().max(100).optional(),
  started_at:   z.string().datetime({ offset: true }).optional(),
});

const IvrEndCallSchema = z.object({
  status:           z.enum(['completed', 'failed', 'no-answer', 'busy', 'cancelled']),
  ended_at:         z.string().datetime({ offset: true }).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  answered_at:      z.string().datetime({ offset: true }).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const IvrEventSchema = z.object({
  event_type: z.string().min(1).max(100),
  metadata:   z.record(z.unknown()).optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
});

const IvrTranscriptSchema = z.object({
  speaker:          z.enum(['agent', 'customer', 'system']),
  content:          z.string().min(1).max(10_000),
  confidence:       z.number().min(0).max(1).optional(),
  word_count:       z.number().int().nonnegative().optional(),
  segment_start_ms: z.number().int().nonnegative().optional(),
  segment_end_ms:   z.number().int().nonnegative().optional(),
  created_at:       z.string().datetime({ offset: true }).optional(),
});

const IvrMetricsSchema = z.object({
  stt_latency_ms:   z.number().int().nonnegative().optional(),
  llm_latency_ms:   z.number().int().nonnegative().optional(),
  tts_latency_ms:   z.number().int().nonnegative().optional(),
  total_latency_ms: z.number().int().nonnegative().optional(),
  packet_loss:      z.number().min(0).max(1).optional(),
  jitter_ms:        z.number().nonnegative().optional(),
  mos_score:        z.number().min(1).max(5).optional(),
});

// ── Helper: extract tenantId (set by apiKeyMiddleware) ────────────────────────

function getTenantId(req: Request): number {
  return (req as any).tenantId as number;
}

// ── Router ────────────────────────────────────────────────────────────────────

export const ivrRouter = Router();

// Step 1: validate API key and attach req.tenantId
ivrRouter.use(apiKeyMiddleware('ivr:write'));

// Step 2: set app.tenant_id in PostgreSQL so RLS activates for all DB queries
// CRITICAL: this was missing in the previous version — without it, every INSERT
// would fail because RLS checks current_setting('app.tenant_id') which was unset.
ivrRouter.use(tenantContextMiddleware);

/**
 * POST /ivr/calls — register a new call.
 * Called by IVR immediately when a Twilio 'start' event fires.
 */
ivrRouter.post('/calls', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body     = IvrStartCallSchema.parse(req.body);

    const call = await callsRepository.create(tenantId, {
      id:           body.id,
      direction:    body.direction,
      from_number:  body.from_number,
      to_number:    body.to_number,
      status:       body.status ?? 'in-progress',
      ivr_flow_id:  body.ivr_flow_id,
      started_at:   body.started_at,
    });

    logger.info({ tenantId, callId: call.id }, 'IVR call started');
    R.created(res, call, 'Call started');
  } catch (e) { next(e); }
});

/**
 * PATCH /ivr/calls/:id — update call status at end of call.
 */
ivrRouter.patch('/calls/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const updates  = IvrEndCallSchema.parse(req.body);
    const call     = await callsRepository.updateStatus(tenantId, req.params.id, {
      ...updates,
      ended_at: updates.ended_at ?? new Date().toISOString(),
    });
    logger.info({ tenantId, callId: req.params.id, status: updates.status }, 'IVR call ended');
    R.success(res, call, 'Call updated');
  } catch (e) { next(e); }
});

/**
 * POST /ivr/calls/:id/events — log a lifecycle event.
 */
ivrRouter.post('/calls/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body     = IvrEventSchema.parse(req.body);
    const event    = await callsRepository.addEvent(tenantId, req.params.id, body);
    R.created(res, event, 'Event logged');
  } catch (e) { next(e); }
});

/**
 * POST /ivr/calls/:id/transcripts — store a transcript segment.
 */
ivrRouter.post('/calls/:id/transcripts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body     = IvrTranscriptSchema.parse(req.body);
    const segment  = await callsRepository.addTranscript(tenantId, req.params.id, body);
    R.created(res, segment, 'Transcript stored');
  } catch (e) { next(e); }
});

/**
 * POST /ivr/calls/:id/metrics — upsert quality metrics.
 */
ivrRouter.post('/calls/:id/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body     = IvrMetricsSchema.parse(req.body);
    const metrics  = await callsRepository.addMetrics(tenantId, req.params.id, body);
    R.created(res, metrics, 'Metrics stored');
  } catch (e) { next(e); }
});