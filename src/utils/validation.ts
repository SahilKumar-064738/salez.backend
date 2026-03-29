import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ── AUTH ──────────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  businessName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  displayName: z.string().min(2).max(80),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ChangePasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

// ── CONTACTS ─────────────────────────────────────────────────────────────────

export const CreateContactSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().max(150).optional(),
  email: z.string().email().optional(),
  stage: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
  notes: z.string().max(2000).optional(),
});

export const UpdateContactSchema = z.object({
  name: z.string().max(150).optional(),
  email: z.string().email().optional().nullable(),
  stage: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export const ContactsQuerySchema = z.object({
  stage: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
  search: z.string().max(100).optional(),
  tag: z.string().max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const TagSchema = z.object({
  tag: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Tag may only contain letters, numbers, hyphens and underscores'),
});

// ── MESSAGES ─────────────────────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  contactId: z.number().int().positive(),
  whatsappAccountId: z.number().int().positive(),
  content: z.string().min(1).max(4096),
  mediaUrl: z.string().url().optional(),
  mediaType: z.string().max(50).optional(),
});

export const InboxQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z.coerce.boolean().default(false),
});

export const ConversationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── TEMPLATES ────────────────────────────────────────────────────────────────

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(150),
  content: z.string().min(1).max(4096),
  variables: z.array(z.string().max(50)).default([]),
  category: z.enum(['marketing', 'utility', 'authentication']).default('marketing'),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

// ── CAMPAIGNS ────────────────────────────────────────────────────────────────

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(150),
  templateId: z.number().int().positive(),
  whatsappAccountId: z.number().int().positive(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  contactIds: z.array(z.number().int().positive()).optional(),
  filters: z
    .object({
      stage: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export const UpdateCampaignSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// ── API KEYS ──────────────────────────────────────────────────────────────────

const VALID_SCOPES = [
  '*',
  'contacts:read', 'contacts:write',
  'messages:read', 'messages:write',
  'campaigns:read', 'campaigns:write',
  'calls:read',
  'whatsapp:read', 'whatsapp:write',
  'settings:read', 'settings:write',
] as const;

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z
    .array(z.string())
    .default(['*'])
    .refine(
      (s) => s.every((scope) => (VALID_SCOPES as readonly string[]).includes(scope)),
      { message: `Scopes must be one of: ${VALID_SCOPES.join(', ')}` }
    ),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

// ── WHATSAPP ACCOUNTS ─────────────────────────────────────────────────────────

export const CreateWhatsAppAccountSchema = z.object({
  phoneNumber: z.string().min(7).max(20),
  displayName: z.string().max(100).optional(),
  apiToken: z.string().min(10),
  provider: z.enum(['meta', 'twilio', 'vonage', 'wati']),
  dailyMessageLimit: z.number().int().positive().max(100000).default(1000),
});

export const UpdateWhatsAppAccountSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyMessageLimit: z.number().int().positive().max(100000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  apiToken: z.string().min(10).optional(),
});

// ── CALLS ─────────────────────────────────────────────────────────────────────

export const CallsListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z
    .enum(['initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'cancelled'])
    .optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  from_date: z.string().datetime({ offset: true }).optional(),
  to_date: z.string().datetime({ offset: true }).optional(),
  contact_id: z.coerce.number().int().positive().optional(),
});

export const CallStatsSchema = z.object({
  from_date: z.string().datetime({ offset: true }).default(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  ),
  to_date: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
  group_by: z.enum(['day', 'week', 'month']).optional(),
});

// ── TENANT SETTINGS ───────────────────────────────────────────────────────────

export const UpdateSettingsSchema = z.object({
  max_users: z.number().int().min(1).max(500).optional(),
  max_contacts: z.number().int().min(100).max(10_000_000).optional(),
  max_whatsapp_accounts: z.number().int().min(1).max(50).optional(),
  max_campaigns: z.number().int().min(1).max(1000).optional(),
  timezone: z.string().max(50).optional(),
  webhook_url: z.string().url().nullable().optional(),
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────

export const AdminImportContactsSchema = z.object({
  tenantId: z.number().int().positive(),
  contacts: z
    .array(
      z.object({
        phone: z.string().min(7).max(20),
        name: z.string().max(150).optional(),
        email: z.string().email().optional(),
      })
    )
    .min(1)
    .max(10000),
});

export const AdminCreateApiKeySchema = z.object({
  tenantId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['*']),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

// ── VALIDATE MIDDLEWARE FACTORY ───────────────────────────────────────────────

type SchemaTarget = 'body' | 'query' | 'params';

export function validate<T extends z.ZodTypeAny>(
  schema: T,
  target: SchemaTarget = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(result.error);
      return;
    }
    // Attach parsed + coerced data back onto the request
    (req as Request & { [key: string]: unknown })[target] = result.data;
    next();
  };
}
export const CreateCallEventSchema = z.object({ event_type: z.string().min(1).max(100), metadata: z.record(z.unknown()).optional(), created_at: z.string().datetime().optional() });
export const CreateCallTranscriptSchema = z.object({ speaker: z.enum(['agent','customer','system']), content: z.string().min(1).max(10000), confidence: z.number().min(0).max(1).optional(), segment_start_ms: z.number().int().nonnegative().optional(), segment_end_ms: z.number().int().nonnegative().optional() });
export const CreateCallRecordingSchema = z.object({ recording_url: z.string().url(), storage_path: z.string().optional(), duration_seconds: z.number().int().nonnegative().optional(), size_bytes: z.number().int().nonnegative().optional() });
export const CreateCallMetricsSchema = z.object({ stt_latency_ms: z.number().int().nonnegative().optional(), llm_latency_ms: z.number().int().nonnegative().optional(), tts_latency_ms: z.number().int().nonnegative().optional(), total_latency_ms: z.number().int().nonnegative().optional(), packet_loss: z.number().min(0).max(1).optional(), jitter_ms: z.number().nonnegative().optional(), bitrate_kbps: z.number().int().positive().optional(), mos_score: z.number().min(1).max(5).optional() });
const CallStatusEnum = z.enum([
  'initiated',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'failed',
  'no-answer',
  'cancelled',
]);

export const CreateCallSchema = z.object({
  id: z.string().optional(),
  direction: z.enum(['inbound','outbound']),
  from_number: z.string().min(5).max(30),
  to_number: z.string().min(5).max(30),
  status: CallStatusEnum.optional(),
  contact_id: z.number().int().positive().optional(),
  assigned_user_id: z.string().uuid().optional(),
  ivr_flow_id: z.string().max(100).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
});

export const UpdateCallSchema = z.object({
  status: CallStatusEnum.optional(),
  answered_at: z.string().datetime().nullable().optional(),
  ended_at: z.string().datetime().nullable().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  cost_currency: z.string().length(3).optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
  contact_id: z.number().int().positive().nullable().optional(),
});