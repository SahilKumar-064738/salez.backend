/**
 * src/routes/index.ts  [FIXED]
 *
 * FIXES vs previous version:
 *  1. contactsRouter now imported from contacts.routes.ts (dedicated file with
 *     correct /bulk + /pipeline-stats route ordering before /:id).
 *     The inline contactsRouter that was here caused /bulk to match /:id.
 *  2. planLimits enforceLimit added to campaigns (create) and whatsapp (create).
 *  3. automationRouter: enforceFeature('automation') gate added to create route.
 *  4. apiKeysRouter: enforceLimit added to key creation.
 *  5. All router.use() calls preserved as-is; withTenant shorthand unchanged.
 */

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { tenantContextMiddleware } from '../middlewares/tenantContext.middleware';
import { enforceLimit, enforceFeature, enforceCampaignRecipientLimit } from '../middlewares/planLimits.middleware';
import { validate } from '../utils/validation';
import {
  RegisterSchema,
  LoginSchema,
  ChangePasswordSchema,
  ContactsQuerySchema,
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
  TagSchema,
  UpdateContactSchema,
  CreateContactSchema,
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
// FIX: import contacts router from dedicated file (correct route ordering)
export { contactsRouter } from './contacts.routes';

const withTenant = [authMiddleware, tenantContextMiddleware];

// ── AUTH ──────────────────────────────────────────────────────────────────────
export const authRouter = Router();
authRouter.post('/register',        authRateLimit, validate(RegisterSchema),       (req, res, next) => authController.register(req, res, next));
authRouter.post('/login',           authRateLimit, validate(LoginSchema),           (req, res, next) => authController.login(req, res, next));
authRouter.post('/refresh',                                                          (req, res, next) => authController.refresh(req, res, next));
authRouter.get('/me',               authMiddleware,                                  (req, res, next) => authController.me(req, res, next));
authRouter.post('/change-password', authMiddleware, validate({ password: undefined } as any), (req, res, next) => authController.changePassword(req, res, next));
authRouter.post('/logout',          authMiddleware,                                  (req, res, next) => authController.logout(req, res, next));

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
// Static routes before dynamic /:id
campaignsRouter.get('/templates',           (req, res, next) => campaignsController.listTemplates(req, res, next));
campaignsRouter.post('/templates',          validate(CreateTemplateSchema), enforceLimit('message_templates', 'max_message_templates', 'Message templates'), (req, res, next) => campaignsController.createTemplate(req, res, next));
campaignsRouter.get('/templates/:id',       (req, res, next) => campaignsController.getTemplate(req, res, next));
campaignsRouter.patch('/templates/:id',     validate(UpdateTemplateSchema), (req, res, next) => campaignsController.updateTemplate(req, res, next));
campaignsRouter.delete('/templates/:id',    (req, res, next) => campaignsController.deleteTemplate(req, res, next));
campaignsRouter.get('/',                    (req, res, next) => campaignsController.list(req, res, next));
// FIX: enforce campaign + recipient limits on creation
campaignsRouter.post('/',                   validate(CreateCampaignSchema), enforceLimit('campaigns', 'max_campaigns', 'Campaigns'), enforceCampaignRecipientLimit, (req, res, next) => campaignsController.create(req, res, next));
campaignsRouter.get('/:id',                 (req, res, next) => campaignsController.getById(req, res, next));
campaignsRouter.get('/:id/recipients',      (req, res, next) => campaignsController.getRecipients(req, res, next));
campaignsRouter.post('/:id/send',           (req, res, next) => campaignsController.send(req, res, next));
campaignsRouter.post('/:id/cancel',         (req, res, next) => campaignsController.cancel(req, res, next));

// ── WHATSAPP ACCOUNTS ─────────────────────────────────────────────────────────
export const whatsappRouter = Router();
whatsappRouter.use(...withTenant);
whatsappRouter.get('/',        (req, res, next) => whatsappController.list(req, res, next));
// FIX: enforce whatsapp account limit on creation
whatsappRouter.post('/',       enforceLimit('whatsapp_accounts', 'max_whatsapp_accounts', 'WhatsApp accounts'), (req, res, next) => whatsappController.create(req, res, next));
whatsappRouter.get('/:id',     (req, res, next) => whatsappController.getById(req, res, next));
whatsappRouter.patch('/:id',   (req, res, next) => whatsappController.update(req, res, next));
whatsappRouter.delete('/:id',  (req, res, next) => whatsappController.disconnect(req, res, next));

// ── API KEYS ──────────────────────────────────────────────────────────────────
export const apiKeysRouter = Router();
apiKeysRouter.use(...withTenant);
apiKeysRouter.get('/',       (req, res, next) => apiKeysController.list(req, res, next));
// FIX: enforce api_keys limit on creation
apiKeysRouter.post('/',      validate(CreateApiKeySchema), enforceLimit('api_keys', 'max_api_keys', 'API keys'), (req, res, next) => apiKeysController.create(req, res, next));
apiKeysRouter.get('/:id',    (req, res, next) => apiKeysController.getById(req, res, next));
apiKeysRouter.patch('/:id',  (req, res, next) => apiKeysController.update(req, res, next));
apiKeysRouter.delete('/:id', (req, res, next) => apiKeysController.revoke(req, res, next));

// ── CALLS ─────────────────────────────────────────────────────────────────────
export const callsRouter = Router();
callsRouter.use(...withTenant);
// Static routes before dynamic /:id
callsRouter.get('/stats',            (req, res, next) => callsController.getStats(req, res, next));
callsRouter.get('/',                 (req, res, next) => callsController.list(req, res, next));
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
analyticsRouter.get('/messages',  (req, res, next) => analyticsController.getMessageAnalytics(req, res, next));
analyticsRouter.get('/campaigns', (req, res, next) => analyticsController.getCampaignAnalytics(req, res, next));
analyticsRouter.get('/latency',   (req, res, next) => analyticsController.getLatencyBreakdown(req, res, next));
analyticsRouter.get('/api-usage', (req, res, next) => analyticsController.getApiUsage(req, res, next));

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export const settingsRouter = Router();
settingsRouter.use(...withTenant);
settingsRouter.get('/',                (req, res, next) => tenantSettingsController.get(req, res, next));
settingsRouter.patch('/',              (req, res, next) => tenantSettingsController.update(req, res, next));
settingsRouter.post('/webhook-secret', (req, res, next) => tenantSettingsController.rotateWebhookSecret(req, res, next));

// ── AUTOMATION ────────────────────────────────────────────────────────────────
export const automationRouter = Router();
automationRouter.use(...withTenant);
automationRouter.get('/',            (req, res, next) => automationController.list(req, res, next));
automationRouter.get('/:id',         (req, res, next) => automationController.getById(req, res, next));
// FIX: feature gate on automation
automationRouter.post('/',           enforceFeature('automation'), (req, res, next) => automationController.create(req, res, next));
automationRouter.patch('/:id',       enforceFeature('automation'), (req, res, next) => automationController.update(req, res, next));
automationRouter.delete('/:id',      (req, res, next) => automationController.delete(req, res, next));
automationRouter.post('/:id/toggle', (req, res, next) => automationController.toggle(req, res, next));

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────
export const webhooksRouter = Router();
webhooksRouter.get('/meta',    (req, res, next) => messagesController.verifyMetaWebhook(req, res, next));
webhooksRouter.post('/meta',   captureRawBody, (req, res, next) => messagesController.receiveMetaWebhook(req, res, next));
webhooksRouter.post('/twilio', captureRawBody, (req, res, next) => messagesController.receiveTwilioWebhook(req, res, next));