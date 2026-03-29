import { serviceRoleClient } from '../config/supabase';
import { NotFoundError, CursorPaginationResult } from '../types';
import { encodeCursor, decodeCursor } from '../utils/pagination';
import { logger } from '../utils/logger';

// ── TYPES ────────────────────────────────────────────────────────────────────

export type CallStatus =
  | 'initiated' | 'ringing' | 'in-progress' | 'completed'
  | 'busy' | 'failed' | 'no-answer' | 'cancelled';

export type CallDirection = 'inbound' | 'outbound';

export interface Call {
  id: string;
  tenant_id: number;
  direction: CallDirection;
  contact_id: number | null;
  assigned_user_id: string | null;
  status: CallStatus;
  from_number: string;
  to_number: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  cost: number | null;
  cost_currency: string;
  ivr_flow_id: string | null;
  created_at: string;
}

export interface CallMetrics {
  id: number;
  call_id: string;
  tenant_id: number;
  stt_latency_ms: number | null;
  llm_latency_ms: number | null;
  tts_latency_ms: number | null;
  total_latency_ms: number | null;
  packet_loss: number | null;
  jitter_ms: number | null;
  bitrate_kbps: number | null;
  mos_score: number | null;
  recorded_at: string;
}

export interface CallTranscript {
  id: number;
  call_id: string;
  tenant_id: number;
  speaker: 'agent' | 'customer' | 'system';
  content: string;
  confidence: number | null;
  word_count: number | null;
  segment_start_ms: number | null;
  segment_end_ms: number | null;
  created_at: string;
}

export interface CallEvent {
  id: number;
  call_id: string;
  tenant_id: number;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CallRecording {
  id: number;
  call_id: string;
  tenant_id: number;
  recording_url: string;
  storage_path: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  is_deleted: boolean;
  created_at: string;
}

export interface CallListFilters {
  cursor?: string;
  limit: number;
  status?: CallStatus;
  direction?: CallDirection;
  fromDate?: string;
  toDate?: string;
  contactId?: number;
  assignedUserId?: string;
}

export interface CallStats {
  total: number;
  completed: number;
  failed: number;
  noAnswer: number;
  busy: number;
  inbound: number;
  outbound: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  totalCost: number;
  avgMosScore: number | null;
  avgTotalLatencyMs: number | null;
}

// ── REPOSITORY ────────────────────────────────────────────────────────────────

export class CallsRepository {
  /**
   * List calls with cursor-based pagination.
   * Queries the partitioned `calls` parent table — Postgres routes to the correct
   * monthly partition automatically (calls_2026_03 etc.).
   */
  async list(
    tenantId: number,
    filters: CallListFilters
  ): Promise<CursorPaginationResult<Call>> {
    const fetchLimit = filters.limit + 1;

    let query = serviceRoleClient
      .from('calls')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(fetchLimit);

    if (filters.status)         query = query.eq('status', filters.status);
    if (filters.direction)      query = query.eq('direction', filters.direction);
    if (filters.fromDate)       query = query.gte('started_at', filters.fromDate);
    if (filters.toDate)         query = query.lte('started_at', filters.toDate);
    if (filters.contactId)      query = query.eq('contact_id', filters.contactId);
    if (filters.assignedUserId) query = query.eq('assigned_user_id', filters.assignedUserId);

    if (filters.cursor) {
      const dec = decodeCursor(filters.cursor);
      if (dec) query = query.lt('started_at', dec.timestamp);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, tenantId }, 'calls list query failed');
      throw error;
    }

    const rows = (data ?? []) as Call[];
    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(0, last.started_at) : null;

    return { data: items, nextCursor, hasMore };
  }

  /**
   * Find a single call by string ID.
   * The tenant_id check enforces strict isolation.
   */
  async findById(tenantId: number, id: string): Promise<Call> {
    const { data, error } = await serviceRoleClient
      .from('calls')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('Call');
    return data as Call;
  }

  /**
   * Get quality metrics for a call (STT/LLM/TTS latency, MOS, jitter).
   */
  async getMetrics(tenantId: number, callId: string): Promise<CallMetrics | null> {
    const { data, error } = await serviceRoleClient
      .from('call_metrics')
      .select('*')
      .eq('call_id', callId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      // PGRST116 = no rows found — not an error for metrics
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as CallMetrics | null;
  }

  /**
   * Get paginated transcript segments, ordered by segment_start_ms ascending.
   * Queries the partitioned call_transcripts parent table.
   */
  async getTranscripts(
    tenantId: number,
    callId: string,
    opts: { limit: number; cursor?: string; speaker?: 'agent' | 'customer' | 'system' }
  ): Promise<CursorPaginationResult<CallTranscript>> {
    const fetchLimit = opts.limit + 1;

    let query = serviceRoleClient
      .from('call_transcripts')
      .select('*')
      .eq('call_id', callId)
      .eq('tenant_id', tenantId)
      .order('segment_start_ms', { ascending: true, nullsFirst: true })
      .limit(fetchLimit);

    if (opts.speaker) query = query.eq('speaker', opts.speaker);

    if (opts.cursor) {
      const dec = decodeCursor(opts.cursor);
      if (dec) query = query.gt('segment_start_ms', dec.id);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as CallTranscript[];
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.segment_start_ms ?? last.id, last.created_at)
        : null;

    return { data: items, nextCursor, hasMore };
  }

  /**
   * Get all lifecycle events for a call, ordered chronologically.
   * Queries the partitioned call_events parent table.
   */
  async getEvents(tenantId: number, callId: string): Promise<CallEvent[]> {
    const { data, error } = await serviceRoleClient
      .from('call_events')
      .select('*')
      .eq('call_id', callId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as CallEvent[];
  }

  /**
   * Get recording metadata for a call.
   * Omits the recording_url from non-active recordings (soft-deleted).
   */
  async getRecording(tenantId: number, callId: string): Promise<Omit<CallRecording, 'storage_path'>> {
    const { data, error } = await serviceRoleClient
      .from('call_recordings')
      .select('id, call_id, tenant_id, recording_url, duration_seconds, size_bytes, is_deleted, created_at')
      .eq('call_id', callId)
      .eq('tenant_id', tenantId)
      .eq('is_deleted', false)
      .single();

    if (error || !data) throw new NotFoundError('Call recording');
    return data;
  }

  /**
   * Aggregated call statistics for a date range.
   * Joins with call_metrics to include average quality scores.
   */
  async getCallStats(
    tenantId: number,
    fromDate: string,
    toDate: string,
    groupBy?: 'day' | 'week' | 'month'
  ): Promise<CallStats> {
    // Fetch calls in range
    const { data: calls, error: callsErr } = await serviceRoleClient
      .from('calls')
      .select('id, status, direction, duration_seconds, cost')
      .eq('tenant_id', tenantId)
      .gte('started_at', fromDate)
      .lte('started_at', toDate);

    if (callsErr) throw callsErr;
    const rows = calls ?? [];

    // Fetch average quality metrics for the same calls
    const callIds = rows.map((r) => r.id);
    let avgMos: number | null = null;
    let avgLatency: number | null = null;

    if (callIds.length > 0) {
      const { data: metrics } = await serviceRoleClient
        .from('call_metrics')
        .select('mos_score, total_latency_ms')
        .eq('tenant_id', tenantId)
        .in('call_id', callIds);

      if (metrics && metrics.length > 0) {
        const mosScores = metrics.filter((m) => m.mos_score != null).map((m) => m.mos_score as number);
        const latencies = metrics.filter((m) => m.total_latency_ms != null).map((m) => m.total_latency_ms as number);
        avgMos = mosScores.length > 0 ? mosScores.reduce((a, b) => a + b, 0) / mosScores.length : null;
        avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
      }
    }

    const completed = rows.filter((r) => r.status === 'completed');
    const totalDuration = completed.reduce((s, r) => s + (r.duration_seconds ?? 0), 0);

    return {
      total: rows.length,
      completed: completed.length,
      failed: rows.filter((r) => r.status === 'failed').length,
      noAnswer: rows.filter((r) => r.status === 'no-answer').length,
      busy: rows.filter((r) => r.status === 'busy').length,
      inbound: rows.filter((r) => r.direction === 'inbound').length,
      outbound: rows.filter((r) => r.direction === 'outbound').length,
      totalDurationSeconds: totalDuration,
      avgDurationSeconds: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
      totalCost: rows.reduce((s, r) => s + (Number(r.cost) || 0), 0),
      avgMosScore: avgMos !== null ? Math.round(avgMos * 100) / 100 : null,
      avgTotalLatencyMs: avgLatency !== null ? Math.round(avgLatency) : null,
    };
  }

  /**
   * Get all calls associated with a specific contact.
   */
  async getContactCalls(
    tenantId: number,
    contactId: number,
    opts: { limit: number; cursor?: string }
  ): Promise<CursorPaginationResult<Call>> {
    const fetchLimit = opts.limit + 1;

    let query = serviceRoleClient
      .from('calls')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('started_at', { ascending: false })
      .limit(fetchLimit);

    if (opts.cursor) {
      const dec = decodeCursor(opts.cursor);
      if (dec) query = query.lt('started_at', dec.timestamp);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Call[];
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(0, last.started_at) : null;

    return { data: items, nextCursor, hasMore };
  }

  // ── WRITE METHODS ──────────────────────────────────────────────────────────

  /**
   * Create a new call record.
   * Inserts into the partitioned `calls` parent table.
   * PostgreSQL routes the INSERT to the correct monthly partition automatically
   * (e.g. calls_2026_03) based on `started_at`.
   */
  async create(tenantId: number, params: {
    id: string;
    direction: CallDirection;
    from_number: string;
    to_number: string;
    status?: CallStatus;
    contact_id?: number;
    assigned_user_id?: string;
    ivr_flow_id?: string;
    started_at?: string;
  }): Promise<Call> {
    const now = new Date().toISOString();
    const { data, error } = await serviceRoleClient
      .from('calls')
      .insert({
        id:               params.id,
        tenant_id:        tenantId,
        direction:        params.direction,
        from_number:      params.from_number,
        to_number:        params.to_number,
        status:           params.status ?? 'initiated',
        contact_id:       params.contact_id ?? null,
        assigned_user_id: params.assigned_user_id ?? null,
        ivr_flow_id:      params.ivr_flow_id ?? null,
        started_at:       params.started_at ?? now,
        created_at:       now,
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, tenantId, callId: params.id }, 'create call failed');
      throw error;
    }
    return data as Call;
  }

  /**
   * Update call fields (status, answered_at, ended_at, duration, cost, etc.).
   * Must include `started_at` in the WHERE clause to satisfy the composite PK
   * (id, started_at) on the partitioned table. We look up the existing row first
   * to retrieve started_at, then update with that constraint so Postgres can
   * route to the right partition.
   */
  async updateStatus(tenantId: number, id: string, updates: Partial<{
    status: CallStatus;
    answered_at: string | null;
    ended_at: string | null;
    duration_seconds: number;
    cost: number;
    cost_currency: string;
    assigned_user_id: string | null;
    contact_id: number | null;
  }>): Promise<Call> {
    // Fetch existing record to get started_at (needed for composite PK update)
    const existing = await this.findById(tenantId, id);

    const { data, error } = await serviceRoleClient
      .from('calls')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('started_at', existing.started_at)
      .select('*')
      .single();

    if (error || !data) {
      logger.error({ error, tenantId, callId: id }, 'update call failed');
      throw error ?? new NotFoundError('Call');
    }
    return data as Call;
  }

  /**
   * Append a lifecycle event to the call.
   * Inserts into the partitioned `call_events` parent table.
   * Partition routing is automatic via the `created_at` column.
   */
  async addEvent(tenantId: number, callId: string, params: {
    event_type: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
  }): Promise<CallEvent> {
    const { data, error } = await serviceRoleClient
      .from('call_events')
      .insert({
        call_id:    callId,
        tenant_id:  tenantId,
        event_type: params.event_type,
        metadata:   params.metadata ?? {},
        created_at: params.created_at ?? new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, tenantId, callId }, 'addEvent failed');
      throw error;
    }
    return data as CallEvent;
  }

  /**
   * Append a transcript segment.
   * Inserts into the partitioned `call_transcripts` parent table.
   * word_count is auto-computed if not supplied.
   */
  async addTranscript(tenantId: number, callId: string, params: {
    speaker: 'agent' | 'customer' | 'system';
    content: string;
    confidence?: number;
    word_count?: number;
    segment_start_ms?: number;
    segment_end_ms?: number;
    created_at?: string;
  }): Promise<CallTranscript> {
    const wordCount = params.word_count ?? params.content.trim().split(/\s+/).length;

    const { data, error } = await serviceRoleClient
      .from('call_transcripts')
      .insert({
        call_id:          callId,
        tenant_id:        tenantId,
        speaker:          params.speaker,
        content:          params.content,
        confidence:       params.confidence ?? null,
        word_count:       wordCount,
        segment_start_ms: params.segment_start_ms ?? null,
        segment_end_ms:   params.segment_end_ms ?? null,
        created_at:       params.created_at ?? new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, tenantId, callId }, 'addTranscript failed');
      throw error;
    }
    return data as CallTranscript;
  }

  /**
   * Store call recording metadata.
   * call_recordings is NOT partitioned — simple insert.
   * Enforces one active recording per call (upsert on call_id + tenant_id).
   */
  async addRecording(tenantId: number, callId: string, params: {
    recording_url: string;
    storage_path?: string;
    duration_seconds?: number;
    size_bytes?: number;
  }): Promise<CallRecording> {
    const { data, error } = await serviceRoleClient
      .from('call_recordings')
      .upsert({
        call_id:          callId,
        tenant_id:        tenantId,
        recording_url:    params.recording_url,
        storage_path:     params.storage_path ?? null,
        duration_seconds: params.duration_seconds ?? null,
        size_bytes:       params.size_bytes ?? null,
        is_deleted:       false,
        created_at:       new Date().toISOString(),
      }, { onConflict: 'call_id,tenant_id' })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, tenantId, callId }, 'addRecording failed');
      throw error;
    }
    return data as CallRecording;
  }

  /**
   * Upsert quality metrics for a call.
   * call_metrics is NOT partitioned — upsert on call_id + tenant_id.
   */
  async addMetrics(tenantId: number, callId: string, params: {
    stt_latency_ms?: number;
    llm_latency_ms?: number;
    tts_latency_ms?: number;
    total_latency_ms?: number;
    packet_loss?: number;
    jitter_ms?: number;
    bitrate_kbps?: number;
    mos_score?: number;
    recorded_at?: string;
  }): Promise<CallMetrics> {
    // Auto-compute total_latency if components supplied but total omitted
    const computedTotal =
      (params.stt_latency_ms ?? 0) +
      (params.llm_latency_ms ?? 0) +
      (params.tts_latency_ms ?? 0);

    const total =
      params.total_latency_ms ??
      (computedTotal > 0 ? computedTotal : null);
    const { data, error } = await serviceRoleClient
      .from('call_metrics')
      .upsert({
        call_id:         callId,
        tenant_id:       tenantId,
        stt_latency_ms:  params.stt_latency_ms ?? null,
        llm_latency_ms:  params.llm_latency_ms ?? null,
        tts_latency_ms:  params.tts_latency_ms ?? null,
        total_latency_ms: total,
        packet_loss:     params.packet_loss ?? null,
        jitter_ms:       params.jitter_ms ?? null,
        bitrate_kbps:    params.bitrate_kbps ?? null,
        mos_score:       params.mos_score ?? null,
        recorded_at:     params.recorded_at ?? new Date().toISOString(),
      }, { onConflict: 'call_id,tenant_id' })
      .select('*')
      .single();

    if (error) {
      logger.error({ error, tenantId, callId }, 'addMetrics failed');
      throw error;
    }
    return data as CallMetrics;
  }
}

export const callsRepository = new CallsRepository();