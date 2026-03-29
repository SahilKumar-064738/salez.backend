import { Request } from 'express';

// ── TENANT & USER ─────────────────────────────────────────────────────────────

export interface Tenant {
  id: number;
  name: string;
  email: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  created_at: string;
  updated_at: string;
}

export interface TenantSettings {
  tenant_id: number;
  max_users: number;
  max_contacts: number;
  max_whatsapp_accounts: number;
  max_campaigns: number;
  timezone: string;
  webhook_url: string | null;
  updated_at: string;
}

export interface UserProfile {
  id: string; // UUID — matches auth.users.id
  tenant_id: number;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── CONTACTS ─────────────────────────────────────────────────────────────────

export type ContactStage = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export interface Contact {
  id: number;
  tenant_id: number;
  phone: string;
  name: string | null;
  email: string | null;
  stage: ContactStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
  last_active: string | null;
  deleted_at: string | null;
}

export interface ContactWithTags extends Contact {
  tags: string[];
}

// ── MESSAGES ─────────────────────────────────────────────────────────────────

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: number;
  tenant_id: number;
  contact_id: number;
  whatsapp_account_id: number | null;
  campaign_id: number | null;
  direction: MessageDirection;
  content: string;
  media_url: string | null;
  media_type: string | null;
  status: MessageStatus;
  external_message_id: string | null;
  is_read: boolean;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface InboxSummary {
  tenant_id: number;
  contact_id: number;
  contact_name: string | null;
  contact_phone: string;
  contact_stage: ContactStage;
  last_message: string;
  last_direction: MessageDirection;
  last_status: MessageStatus;
  is_read: boolean;
  last_message_at: string;
  unread_count: number;
}

// ── CAMPAIGNS ────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'draft' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Campaign {
  id: number;
  tenant_id: number;
  name: string;
  template_id: number | null;
  whatsapp_account_id: number | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageTemplate {
  id: number;
  tenant_id: number;
  name: string;
  content: string;
  variables: string[];
  category: 'marketing' | 'utility' | 'authentication';
  status: 'draft' | 'approved' | 'rejected' | 'pending_review';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: number;
  campaign_id: number;
  tenant_id: number;
  contact_id: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'opted_out';
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
}

// ── WHATSAPP ─────────────────────────────────────────────────────────────────

export interface WhatsAppAccount {
  id: number;
  tenant_id: number;
  phone_number: string;
  display_name: string | null;
  api_token_encrypted: string; // NEVER expose raw token via API
  provider: 'meta' | 'twilio' | 'vonage' | 'wati';
  status: 'active' | 'inactive' | 'suspended' | 'disconnected';
  connected_at: string;
  last_sent_at: string | null;
  daily_message_limit: number;
}

// ── CALLS / IVR ───────────────────────────────────────────────────────────────

export type CallStatus =
  | 'initiated' | 'ringing' | 'in-progress' | 'completed'
  | 'busy' | 'failed' | 'no-answer' | 'cancelled';

export type CallDirection = 'inbound' | 'outbound';

export interface Call {
  id: string; // text PK (e.g. Twilio call SID)
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

// ── API KEYS ──────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: number;
  tenant_id: number;
  created_by: string;
  name: string;
  key_prefix: string;
  // key_hash intentionally omitted from this type — never returned via API
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
}

// ── QUEUE JOBS ────────────────────────────────────────────────────────────────

export interface SendMessageJob {
  tenantId: number;
  contactId: number;
  whatsappAccountId: number;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  campaignId?: number;
  recipientId?: number;
}

export interface CampaignJob {
  tenantId: number;
  campaignId: number;
  batchSize?: number;
  offset?: number;
}

export interface WebhookJob {
  provider: 'meta' | 'twilio';
  payload: unknown;
  receivedAt: string;
}

// ── PAGINATION ────────────────────────────────────────────────────────────────

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── AUTH / REQUEST ────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string;        // auth.users.id (UUID)
  tenantId: number;
  role: UserProfile['role'];
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  accessToken: string;
}

export interface ApiKeyRequest extends Request {
  tenantId: number;
  apiKeyId: number;
}

// ── API RESPONSES ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
}

// ── ERRORS ────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}