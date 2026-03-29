import { Request, Response, NextFunction } from 'express';
import { messagesRepository } from '../repositories/messages.repository';
import { sendMessageQueue, webhookProcessQueue } from '../queues';
import { AuthenticatedRequest, AppError } from '../types';
import { env } from '../config/env';
import { verifyMetaSignature, verifyTwilioSignature } from '../utils/crypto';
import * as R from '../utils/response';
import { InboxQuerySchema, ConversationQuerySchema, SendMessageSchema } from '../utils/validation';

export class MessagesController {
  /**
   * POST /messages/send
   */
  async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = SendMessageSchema.parse(req.body);

      // Validate the WhatsApp account belongs to this tenant (throws 404 if not)
      await messagesRepository.getWhatsAppAccount(user.tenantId, body.whatsappAccountId);

      // Create pending message record so it appears in UI immediately
      const message = await messagesRepository.createOutbound({
        tenantId: user.tenantId,
        contactId: body.contactId,
        whatsappAccountId: body.whatsappAccountId,
        content: body.content,
        mediaUrl: body.mediaUrl,
        mediaType: body.mediaType,
      });

      // Enqueue send job
      await sendMessageQueue.add(
        `send-${message.id}`,
        {
          tenantId: user.tenantId,
          contactId: body.contactId,
          whatsappAccountId: body.whatsappAccountId,
          content: body.content,
          mediaUrl: body.mediaUrl,
          mediaType: body.mediaType,
        },
        { jobId: `msg-${message.id}` }
      );

      R.created(res, {
        messageId: message.id,
        status: 'pending',
        queuedAt: new Date().toISOString(),
      }, 'Message queued for sending');
    } catch (err) { next(err); }
  }

  /**
   * GET /messages/inbox
   */
  async getInbox(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const query = InboxQuerySchema.parse(req.query);
      const result = await messagesRepository.getInbox(user.tenantId, query);
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (err) { next(err); }
  }

  /**
   * GET /messages/conversation/:contactId
   */
  async getConversation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const contactId = parseInt(req.params.contactId, 10);
      if (isNaN(contactId)) throw new AppError('Invalid contactId', 400, 'INVALID_PARAM');
      const query = ConversationQuerySchema.parse(req.query);
      const result = await messagesRepository.getConversation(user.tenantId, contactId, query);
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (err) { next(err); }
  }

  /**
   * PUT /messages/conversation/:contactId/read
   */
  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const contactId = parseInt(req.params.contactId, 10);
      if (isNaN(contactId)) throw new AppError('Invalid contactId', 400, 'INVALID_PARAM');
      await messagesRepository.markConversationRead(user.tenantId, contactId);
      R.success(res, null, 'Conversation marked as read');
    } catch (err) { next(err); }
  }

  /**
   * GET /webhooks/meta
   * Meta challenge-response verification (required when setting up webhook URL).
   */
  async verifyMetaWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const mode      = req.query['hub.mode'] as string;
    const token     = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
  }

  /**
   * POST /webhooks/meta
   * Receives WhatsApp Business API events.
   * Signature is verified by the captureRawBody middleware (already mounted on this route).
   * Always returns 200 immediately to prevent Meta retries.
   */
  async receiveMetaWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Verify HMAC signature
      if (env.META_APP_SECRET) {
        const sig = req.headers['x-hub-signature-256'] as string | undefined;
        if (!sig || !verifyMetaSignature(env.META_APP_SECRET, req.body as Buffer, sig)) {
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }

      // Always respond 200 before processing to prevent Meta retries
      res.status(200).json({ received: true });

      // Parse body (it's a raw Buffer at this point due to express.raw())
      let payload: unknown;
      try {
        payload = JSON.parse((req.body as Buffer).toString('utf8'));
      } catch {
        return; // malformed JSON — already responded 200
      }

      await webhookProcessQueue.add('meta-webhook', {
        provider: 'meta',
        payload,
        receivedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Already responded 200, just log
      next(err);
    }
  }

  /**
   * POST /webhooks/twilio
   * Receives Twilio status callbacks.
   */
  async receiveTwilioWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Verify Twilio signature if auth token is configured
      if (env.TWILIO_AUTH_TOKEN) {
        const sig = req.headers['x-twilio-signature'] as string | undefined;
        const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const params = req.body as Record<string, string>;

        if (!sig || !verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, sig, url, params)) {
          res.status(401).type('text/xml').send('<Response/>');
          return;
        }
      }

      // Twilio expects TwiML response
      res.status(200).type('text/xml').send('<Response/>');

      await webhookProcessQueue.add('twilio-webhook', {
        provider: 'twilio',
        payload: req.body,
        receivedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
}

export const messagesController = new MessagesController();
