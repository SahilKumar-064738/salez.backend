import { Request, Response, NextFunction } from 'express';
import { callsRepository } from '../repositories/calls.repository';
import { AuthenticatedRequest } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';
import { randomBytes } from 'crypto';

// ── SCHEMAS ───────────────────────────────────────────────────────────────────

const CallsListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(['initiated','ringing','in-progress','completed','busy','failed','no-answer','cancelled']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  from_date: z.string().datetime({ offset: true }).optional(),
  to_date: z.string().datetime({ offset: true }).optional(),
  contact_id: z.coerce.number().int().positive().optional(),
  assigned_user_id: z.string().uuid().optional(),
});

const TranscriptsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  speaker: z.enum(['agent', 'customer', 'system']).optional(),
});

const StatsQuerySchema = z.object({
  from_date: z.string().datetime({ offset: true }).default(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  ),
  to_date: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  group_by: z.enum(['day', 'week', 'month']).optional(),
});

const ContactCallsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateCallSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  direction: z.enum(['inbound', 'outbound']),
  from_number: z.string().min(5).max(30),
  to_number: z.string().min(5).max(30),
  status: z.enum(['initiated','ringing','in-progress','completed','busy','failed','no-answer','cancelled']).optional(),
  contact_id: z.number().int().positive().optional(),
  assigned_user_id: z.string().uuid().optional(),
  ivr_flow_id: z.string().max(100).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
});

const UpdateCallSchema = z.object({
  status: z.enum(['initiated','ringing','in-progress','completed','busy','failed','no-answer','cancelled']).optional(),
  answered_at: z.string().datetime({ offset: true }).nullable().optional(),
  ended_at: z.string().datetime({ offset: true }).nullable().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  cost_currency: z.string().length(3).optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
  contact_id: z.number().int().positive().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const CreateCallEventSchema = z.object({
  event_type: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
});

const CreateCallTranscriptSchema = z.object({
  speaker: z.enum(['agent', 'customer', 'system']),
  content: z.string().min(1).max(10000),
  confidence: z.number().min(0).max(1).optional(),
  word_count: z.number().int().nonnegative().optional(),
  segment_start_ms: z.number().int().nonnegative().optional(),
  segment_end_ms: z.number().int().nonnegative().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
});

const CreateCallRecordingSchema = z.object({
  recording_url: z.string().url(),
  storage_path: z.string().max(500).optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const CreateCallMetricsSchema = z.object({
  stt_latency_ms: z.number().int().nonnegative().optional(),
  llm_latency_ms: z.number().int().nonnegative().optional(),
  tts_latency_ms: z.number().int().nonnegative().optional(),
  total_latency_ms: z.number().int().nonnegative().optional(),
  packet_loss: z.number().min(0).max(1).optional(),
  jitter_ms: z.number().nonnegative().optional(),
  bitrate_kbps: z.number().int().positive().optional(),
  mos_score: z.number().min(1).max(5).optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
});

// ── CONTROLLER ────────────────────────────────────────────────────────────────

export class CallsController {
  /** GET /calls — list with cursor pagination + filters */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = CallsListSchema.parse(req.query);
      const result = await callsRepository.list(user.tenantId, {
        cursor: q.cursor, limit: q.limit, status: q.status,
        direction: q.direction, fromDate: q.from_date, toDate: q.to_date,
        contactId: q.contact_id, assignedUserId: q.assigned_user_id,
      });
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (e) { next(e); }
  }

  /** GET /calls/stats — aggregated statistics */
  async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = StatsQuerySchema.parse(req.query);
      const stats = await callsRepository.getCallStats(user.tenantId, q.from_date, q.to_date, q.group_by);
      R.success(res, stats);
    } catch (e) { next(e); }
  }

  /** POST /calls — create call record */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateCallSchema.parse(req.body);
      const callId = body.id ?? `call_${randomBytes(8).toString('hex')}`;
      const call = await callsRepository.create(user.tenantId, { ...body, id: callId });
      R.created(res, call, 'Call created');
    } catch (e) { next(e); }
  }

  /** GET /calls/:id — single call */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const call = await callsRepository.findById(user.tenantId, req.params.id);
      R.success(res, call);
    } catch (e) { next(e); }
  }

  /** PATCH /calls/:id — update status/timestamps/cost */
  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const updates = UpdateCallSchema.parse(req.body);
      const call = await callsRepository.updateStatus(user.tenantId, req.params.id, updates);
      R.success(res, call, 'Call updated');
    } catch (e) { next(e); }
  }

  /** GET /calls/:id/metrics */
  async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const metrics = await callsRepository.getMetrics(user.tenantId, req.params.id);
      R.success(res, metrics);
    } catch (e) { next(e); }
  }

  /** POST /calls/:id/metrics — store/update quality metrics */
  async addMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateCallMetricsSchema.parse(req.body);
      const metrics = await callsRepository.addMetrics(user.tenantId, req.params.id, body);
      R.created(res, metrics, 'Metrics stored');
    } catch (e) { next(e); }
  }

  /** GET /calls/:id/transcripts — paginated transcript segments */
  async getTranscripts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = TranscriptsQuerySchema.parse(req.query);
      const result = await callsRepository.getTranscripts(user.tenantId, req.params.id, q);
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (e) { next(e); }
  }

  /** POST /calls/:id/transcripts — append a transcript segment */
  async addTranscript(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateCallTranscriptSchema.parse(req.body);
      const transcript = await callsRepository.addTranscript(user.tenantId, req.params.id, body);
      R.created(res, transcript, 'Transcript segment added');
    } catch (e) { next(e); }
  }

  /** GET /calls/:id/events — lifecycle events */
  async getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const events = await callsRepository.getEvents(user.tenantId, req.params.id);
      R.success(res, events);
    } catch (e) { next(e); }
  }

  /** POST /calls/:id/events — append a lifecycle event */
  async addEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateCallEventSchema.parse(req.body);
      const event = await callsRepository.addEvent(user.tenantId, req.params.id, body);
      R.created(res, event, 'Event added');
    } catch (e) { next(e); }
  }

  /** GET /calls/:id/recording */
  async getRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const recording = await callsRepository.getRecording(user.tenantId, req.params.id);
      R.success(res, recording);
    } catch (e) { next(e); }
  }

  /** POST /calls/:id/recording — store recording metadata */
  async addRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateCallRecordingSchema.parse(req.body);
      const recording = await callsRepository.addRecording(user.tenantId, req.params.id, body);
      R.created(res, recording, 'Recording stored');
    } catch (e) { next(e); }
  }

  /** GET /contacts/:contactId/calls — calls for a contact */
  async getContactCalls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const contactId = parseInt(req.params.contactId, 10);
      const q = ContactCallsSchema.parse(req.query);
      const result = await callsRepository.getContactCalls(user.tenantId, contactId, q);
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (e) { next(e); }
  }
}

export const callsController = new CallsController();