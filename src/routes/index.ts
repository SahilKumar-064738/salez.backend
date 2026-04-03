/**
 * src/routes/index.ts — COMPLETE
 *
 * KEY CHANGES vs previous version:
 *   1. tenantContextMiddleware imported and applied to EVERY authenticated router
 *      via router.use(authMiddleware, tenantContextMiddleware).
 *      This ensures set_tenant_context(tenantId) is called before every DB
 *      query so RLS policies activate correctly.
 *
 *   2. Automation router added (was missing from previous version).
 *
 *   3. Webhooks router intentionally skips tenantContext — webhook endpoints
 *      look up tenant from the incoming payload before touching the DB.
 *
 *   4. IVR routes have their own tenantContext inside ivr.routes.ts
 *      (applied after apiKeyMiddleware, not here).
 */

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { tenantContextMiddleware } from '../middlewares/tenantContext.middleware';
import { validate } from '../utils/validation';
import {
  RegisterSchema,
  LoginSchema,
  ChangePasswordSchema,
  CreateContactSchema,
  UpdateContactSchema,
  ContactsQuerySchema,
  TagSchema,
  SendMessageSchema,
  InboxQuerySchema,
  ConversationQuerySchema,
  CreateCampaignSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  CreateApiKeySchema,
  CreateCallSchema,
  UpdateCallSchema,
  CreateCallEventSchema,
  CreateCallTranscriptSchema,
  CreateCallRecordingSchema,
  CreateCallMetricsSchema,
} from '../utils/validation';

import { authController }           from '../controllers/auth.controller';
import { contactsController }       from '../controllers/contacts.controller';
import { messagesController }       from '../controllers/messages.controller';
import { campaignsController }      from '../controllers/campaigns.controller';
import { whatsappController }       from '../controllers/whatsapp.controller';
import { apiKeysController }        from '../controllers/apiKeys.controller';
import { callsController }          from '../controllers/calls.controller';
import { analyticsController }      from '../controllers/analytics.controller';
import { tenantSettingsController } from '../controllers/tenantSettings.controller';
import { automationController }     from '../controllers/automation.controller';
import { captureRawBody }           from '../middlewares/webhook.middleware';
import { authRateLimit }            from '../middlewares/rateLimit.middleware';

// Re-export sub-routers that server.ts mounts
export { ivrRouter }   from './ivr.routes';
export { adminRouter } from './admin.routes';

// ── Shorthand: auth + tenant context applied together ─────────────────────────
// Apply to every router that touches tenant-scoped data.
const withTenant = [authMiddleware, tenantContextMiddleware];

// ── AUTH ──────────────────────────────────────────────────────────────────────
// Auth endpoints are NOT tenant-scoped (they create/validate identity).
export const authRouter = Router();
authRouter.post('/register',       authRateLimit, validate(RegisterSchema),       (req, res, next) => authController.register(req, res, next));
authRouter.post('/login',          authRateLimit, validate(LoginSchema),           (req, res, next) => authController.login(req, res, next));
authRouter.post('/refresh',                                                         (req, res, next) => authController.refresh(req, res, next));
// /me and change-password need authMiddleware but NOT tenantContext (no DB write)
authRouter.get('/me',              authMiddleware,                                  (req, res, next) => authController.me(req, res, next));
authRouter.post('/change-password', authMiddleware, validate(ChangePasswordSchema), (req, res, next) => authController.changePassword(req, res, next));
authRouter.post('/logout',         authMiddleware,                                  (req, res, next) => authController.logout(req, res, next));

// ── CONTACTS ──────────────────────────────────────────────────────────────────
export const contactsRouter = Router();
contactsRouter.use(...withTenant);
contactsRouter.get('/',                 validate(ContactsQuerySchema, 'query'), (req, res, next) => contactsController.list(req, res, next));
contactsRouter.get('/pipeline-stats',                                           (req, res, next) => contactsController.getPipelineStats(req, res, next));
contactsRouter.get('/:id',                                                      (req, res, next) => contactsController.getById(req, res, next));
contactsRouter.post('/',                validate(CreateContactSchema),           (req, res, next) => contactsController.create(req, res, next));
contactsRouter.patch('/:id',            validate(UpdateContactSchema),           (req, res, next) => contactsController.update(req, res, next));
contactsRouter.delete('/:id',                                                   (req, res, next) => contactsController.delete(req, res, next));
contactsRouter.post('/:id/tags',        validate(TagSchema),                    (req, res, next) => contactsController.addTag(req, res, next));
contactsRouter.delete('/:id/tags/:tag',                                         (req, res, next) => contactsController.removeTag(req, res, next));
contactsRouter.get('/:contactId/calls',                                         (req, res, next) => callsController.getContactCalls(req, res, next));
contactsRouter.post('/bulk', (req, res, next) =>
  contactsController.bulkCreate(req, res, next)
);
// ── MESSAGES ──────────────────────────────────────────────────────────────────
export const messagesRouter = Router();
messagesRouter.use(...withTenant);
messagesRouter.post('/send',                         validate(SendMessageSchema),               (req, res, next) => messagesController.send(req, res, next));
messagesRouter.get('/inbox',                         validate(InboxQuerySchema, 'query'),       (req, res, next) => messagesController.getInbox(req, res, next));
messagesRouter.get('/conversation/:contactId',       validate(ConversationQuerySchema, 'query'),(req, res, next) => messagesController.getConversation(req, res, next));
messagesRouter.put('/conversation/:contactId/read',                                             (req, res, next) => messagesController.markRead(req, res, next));

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
export const campaignsRouter = Router();
campaignsRouter.use(...withTenant);
campaignsRouter.get('/templates',           (req, res, next) => campaignsController.listTemplates(req, res, next));
campaignsRouter.get('/templates/:id',       (req, res, next) => campaignsController.getTemplate(req, res, next));
campaignsRouter.post('/templates',          validate(CreateTemplateSchema), (req, res, next) => campaignsController.createTemplate(req, res, next));
campaignsRouter.patch('/templates/:id',     validate(UpdateTemplateSchema), (req, res, next) => campaignsController.updateTemplate(req, res, next));
campaignsRouter.delete('/templates/:id',    (req, res, next) => campaignsController.deleteTemplate(req, res, next));
campaignsRouter.get('/',                    (req, res, next) => campaignsController.list(req, res, next));
campaignsRouter.get('/:id',                 (req, res, next) => campaignsController.getById(req, res, next));
campaignsRouter.get('/:id/recipients',      (req, res, next) => campaignsController.getRecipients(req, res, next));
campaignsRouter.post('/',                   validate(CreateCampaignSchema), (req, res, next) => campaignsController.create(req, res, next));
campaignsRouter.post('/:id/send',           (req, res, next) => campaignsController.send(req, res, next));
campaignsRouter.post('/:id/cancel',         (req, res, next) => campaignsController.cancel(req, res, next));

// ── WHATSAPP ACCOUNTS ─────────────────────────────────────────────────────────
export const whatsappRouter = Router();
whatsappRouter.use(...withTenant);
whatsappRouter.get('/',        (req, res, next) => whatsappController.list(req, res, next));
whatsappRouter.get('/:id',     (req, res, next) => whatsappController.getById(req, res, next));
whatsappRouter.post('/',       (req, res, next) => whatsappController.create(req, res, next));
whatsappRouter.patch('/:id',   (req, res, next) => whatsappController.update(req, res, next));
whatsappRouter.delete('/:id',  (req, res, next) => whatsappController.disconnect(req, res, next));

// ── API KEYS ──────────────────────────────────────────────────────────────────
export const apiKeysRouter = Router();
apiKeysRouter.use(...withTenant);
apiKeysRouter.get('/',       (req, res, next) => apiKeysController.list(req, res, next));
apiKeysRouter.get('/:id',    (req, res, next) => apiKeysController.getById(req, res, next));
apiKeysRouter.post('/',      validate(CreateApiKeySchema), (req, res, next) => apiKeysController.create(req, res, next));
apiKeysRouter.patch('/:id',  (req, res, next) => apiKeysController.update(req, res, next));
apiKeysRouter.delete('/:id', (req, res, next) => apiKeysController.revoke(req, res, next));

// ── CALLS ─────────────────────────────────────────────────────────────────────
export const callsRouter = Router();
callsRouter.use(...withTenant);
callsRouter.get('/',                 (req, res, next) => callsController.list(req, res, next));
callsRouter.get('/stats',            (req, res, next) => callsController.getStats(req, res, next));
callsRouter.post('/',                validate(CreateCallSchema),           (req, res, next) => callsController.create(req, res, next));
callsRouter.get('/:id',              (req, res, next) => callsController.getById(req, res, next));
callsRouter.patch('/:id',            validate(UpdateCallSchema),           (req, res, next) => callsController.updateStatus(req, res, next));
callsRouter.get('/:id/metrics',      (req, res, next) => callsController.getMetrics(req, res, next));
callsRouter.post('/:id/metrics',     validate(CreateCallMetricsSchema),    (req, res, next) => callsController.addMetrics(req, res, next));
callsRouter.get('/:id/transcripts',  (req, res, next) => callsController.getTranscripts(req, res, next));
callsRouter.post('/:id/transcripts', validate(CreateCallTranscriptSchema), (req, res, next) => callsController.addTranscript(req, res, next));
callsRouter.get('/:id/events',       (req, res, next) => callsController.getEvents(req, res, next));
callsRouter.post('/:id/events',      validate(CreateCallEventSchema),      (req, res, next) => callsController.addEvent(req, res, next));
callsRouter.get('/:id/recording',    (req, res, next) => callsController.getRecording(req, res, next));
callsRouter.post('/:id/recording',   validate(CreateCallRecordingSchema),  (req, res, next) => callsController.addRecording(req, res, next));

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
export const analyticsRouter = Router();
analyticsRouter.use(...withTenant);
analyticsRouter.get('/calls',     (req, res, next) => analyticsController.getCallAnalytics(req, res, next));
analyticsRouter.get('/messages',  (req, res, next) => analyticsController.getMessageAnalytics(req, res, next));  // NEW
analyticsRouter.get('/campaigns', (req, res, next) => analyticsController.getCampaignAnalytics(req, res, next)); // NEW
analyticsRouter.get('/latency',   (req, res, next) => analyticsController.getLatencyBreakdown(req, res, next));
analyticsRouter.get('/api-usage', (req, res, next) => analyticsController.getApiUsage(req, res, next));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export const settingsRouter = Router();
settingsRouter.use(...withTenant);
settingsRouter.get('/',                (req, res, next) => tenantSettingsController.get(req, res, next));
settingsRouter.patch('/',              (req, res, next) => tenantSettingsController.update(req, res, next));
settingsRouter.post('/webhook-secret', (req, res, next) => tenantSettingsController.rotateWebhookSecret(req, res, next));

// ── AUTOMATION ────────────────────────────────────────────────────────────────
// NEW: was completely missing from previous version
export const automationRouter = Router();
automationRouter.use(...withTenant);
automationRouter.get('/',          (req, res, next) => automationController.list(req, res, next));
automationRouter.get('/:id',       (req, res, next) => automationController.getById(req, res, next));
automationRouter.post('/',         (req, res, next) => automationController.create(req, res, next));
automationRouter.patch('/:id',     (req, res, next) => automationController.update(req, res, next));
automationRouter.delete('/:id',    (req, res, next) => automationController.delete(req, res, next));
automationRouter.post('/:id/toggle', (req, res, next) => automationController.toggle(req, res, next));

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────
// Webhooks intentionally have NO auth or tenantContext middleware here.
// They are public endpoints (Meta/Twilio call them). Tenant is resolved
// inside the controller from the webhook payload (phone number → wa_account → tenant).
export const webhooksRouter = Router();
webhooksRouter.get('/meta',    (req, res, next) => messagesController.verifyMetaWebhook(req, res, next));
webhooksRouter.post('/meta',   captureRawBody, (req, res, next) => messagesController.receiveMetaWebhook(req, res, next));
webhooksRouter.post('/twilio', captureRawBody, (req, res, next) => messagesController.receiveTwilioWebhook(req, res, next));