import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
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
import { captureRawBody }           from '../middlewares/webhook.middleware';
import { authRateLimit }            from '../middlewares/rateLimit.middleware';

export const authRouter = Router();
authRouter.post('/register', authRateLimit, validate(RegisterSchema),       (req, res, next) => authController.register(req, res, next));
authRouter.post('/login',    authRateLimit, validate(LoginSchema),           (req, res, next) => authController.login(req, res, next));
authRouter.post('/refresh',                                                  (req, res, next) => authController.refresh(req, res, next));
authRouter.get('/me',        authMiddleware,                                 (req, res, next) => authController.me(req, res, next));
authRouter.post('/change-password', authMiddleware, validate(ChangePasswordSchema), (req, res, next) => authController.changePassword(req, res, next));
authRouter.post('/logout',   authMiddleware,                                 (req, res, next) => authController.logout(req, res, next));

export const contactsRouter = Router();
contactsRouter.use(authMiddleware);
contactsRouter.get('/',                 validate(ContactsQuerySchema, 'query'), (req, res, next) => contactsController.list(req, res, next));
contactsRouter.get('/pipeline-stats',                                           (req, res, next) => contactsController.getPipelineStats(req, res, next));
contactsRouter.get('/:id',                                                      (req, res, next) => contactsController.getById(req, res, next));
contactsRouter.post('/',                validate(CreateContactSchema),           (req, res, next) => contactsController.create(req, res, next));
contactsRouter.patch('/:id',            validate(UpdateContactSchema),           (req, res, next) => contactsController.update(req, res, next));
contactsRouter.delete('/:id',                                                   (req, res, next) => contactsController.delete(req, res, next));
contactsRouter.post('/:id/tags',        validate(TagSchema),                    (req, res, next) => contactsController.addTag(req, res, next));
contactsRouter.delete('/:id/tags/:tag',                                         (req, res, next) => contactsController.removeTag(req, res, next));
contactsRouter.get('/:contactId/calls',                                         (req, res, next) => callsController.getContactCalls(req, res, next));

export const messagesRouter = Router();
messagesRouter.use(authMiddleware);
messagesRouter.post('/send',                         validate(SendMessageSchema),               (req, res, next) => messagesController.send(req, res, next));
messagesRouter.get('/inbox',                         validate(InboxQuerySchema, 'query'),       (req, res, next) => messagesController.getInbox(req, res, next));
messagesRouter.get('/conversation/:contactId',       validate(ConversationQuerySchema, 'query'),(req, res, next) => messagesController.getConversation(req, res, next));
messagesRouter.put('/conversation/:contactId/read',                                             (req, res, next) => messagesController.markRead(req, res, next));

export const campaignsRouter = Router();
campaignsRouter.use(authMiddleware);
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

export const whatsappRouter = Router();
whatsappRouter.use(authMiddleware);
whatsappRouter.get('/',        (req, res, next) => whatsappController.list(req, res, next));
whatsappRouter.get('/:id',     (req, res, next) => whatsappController.getById(req, res, next));
whatsappRouter.post('/',       (req, res, next) => whatsappController.create(req, res, next));
whatsappRouter.patch('/:id',   (req, res, next) => whatsappController.update(req, res, next));
whatsappRouter.delete('/:id',  (req, res, next) => whatsappController.disconnect(req, res, next));

export const apiKeysRouter = Router();
apiKeysRouter.use(authMiddleware);
apiKeysRouter.get('/',       (req, res, next) => apiKeysController.list(req, res, next));
apiKeysRouter.get('/:id',    (req, res, next) => apiKeysController.getById(req, res, next));
apiKeysRouter.post('/',      validate(CreateApiKeySchema), (req, res, next) => apiKeysController.create(req, res, next));
apiKeysRouter.patch('/:id',  (req, res, next) => apiKeysController.update(req, res, next));
apiKeysRouter.delete('/:id', (req, res, next) => apiKeysController.revoke(req, res, next));

export const callsRouter = Router();
callsRouter.use(authMiddleware);
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

export const analyticsRouter = Router();
analyticsRouter.use(authMiddleware);
analyticsRouter.get('/calls',     (req, res, next) => analyticsController.getCallAnalytics(req, res, next));
analyticsRouter.get('/latency',   (req, res, next) => analyticsController.getLatencyBreakdown(req, res, next));
analyticsRouter.get('/api-usage', (req, res, next) => analyticsController.getApiUsage(req, res, next));

export const settingsRouter = Router();
settingsRouter.use(authMiddleware);
settingsRouter.get('/',               (req, res, next) => tenantSettingsController.get(req, res, next));
settingsRouter.patch('/',             (req, res, next) => tenantSettingsController.update(req, res, next));
settingsRouter.post('/webhook-secret', (req, res, next) => tenantSettingsController.rotateWebhookSecret(req, res, next));

export const webhooksRouter = Router();
webhooksRouter.get('/meta',  (req, res, next) => messagesController.verifyMetaWebhook(req, res, next));
webhooksRouter.post('/meta',   captureRawBody, (req, res, next) => messagesController.receiveMetaWebhook(req, res, next));
webhooksRouter.post('/twilio', captureRawBody, (req, res, next) => messagesController.receiveTwilioWebhook(req, res, next));

export { adminRouter } from './admin.routes';