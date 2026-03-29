import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { getRedis, connectRedis } from '../config/redis';
import { serviceRoleClient } from '../config/supabase';
import { logger } from '../utils/logger';
import { SendMessageJob, CampaignJob, WebhookJob } from '../types';
import { whatsappRepository } from '../repositories/whatsapp.repository';
import { messagesRepository } from '../repositories/messages.repository';

const connection = { connection: getRedis() };

// ── SEND MESSAGE WORKER ───────────────────────────────────────────────────────

const sendMessageWorker = new Worker(
  'send-message',
  async (job: Job<SendMessageJob>) => {
    const { tenantId, contactId, whatsappAccountId, content, mediaUrl, mediaType, campaignId, recipientId } = job.data;

    // Get WhatsApp account with decrypted token
    const account = await whatsappRepository.findByIdWithToken(tenantId, whatsappAccountId);

    // Resolve contact phone number
    const { data: contact } = await serviceRoleClient
      .from('contacts')
      .select('phone')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .single();

    const toPhone = contact?.phone ?? '';

    let externalMessageId: string | undefined;
    try {
      if (account.provider === 'meta') {
        const apiUrl = `https://graph.facebook.com/v18.0/${account.phone_number}/messages`;
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${account.api_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            type: mediaUrl ? 'image' : 'text',
            ...(mediaUrl
              ? { image: { link: mediaUrl, caption: content } }
              : { text: { body: content } }),
          }),
        });
        const result = await resp.json() as { messages?: Array<{ id: string }>; error?: unknown };
        if (result.error) throw new Error(`Meta API error: ${JSON.stringify(result.error)}`);
        externalMessageId = result.messages?.[0]?.id;
      }
      // Additional providers (Twilio, Vonage, WATI) extendable here
    } catch (sendErr) {
      logger.error({ sendErr, jobId: job.id }, 'Provider send failed');
      // Look up the most recent pending outbound message for this contact
      const { data: msg } = await serviceRoleClient
        .from('messages')
        .select('id, sent_at')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .eq('direction', 'outbound')
        .eq('status', 'pending')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();
      if (msg) await messagesRepository.updateStatus(msg.id, 'failed');
      if (recipientId) {
        await serviceRoleClient
          .from('campaign_recipients')
          .update({ status: 'failed', error_message: (sendErr as Error).message })
          .eq('id', recipientId);
      }
      throw sendErr;
    }

    // Find the pending message row and mark sent
    const { data: msg } = await serviceRoleClient
      .from('messages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('direction', 'outbound')
      .eq('status', 'pending')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (msg) {
      await messagesRepository.updateStatus(msg.id, 'sent', { externalMessageId });
    }

    if (recipientId) {
      await serviceRoleClient
        .from('campaign_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', recipientId);
    }

    // Touch last_sent_at on WhatsApp account (fire-and-forget)
    whatsappRepository.touchLastSent(tenantId, whatsappAccountId).catch(() => {});

    logger.info({ tenantId, contactId, externalMessageId }, 'Message sent');
  },
  {
    ...connection,
    concurrency: 20,
    limiter: { max: 50, duration: 1000 },
  }
);

// ── CAMPAIGN DISPATCH WORKER ──────────────────────────────────────────────────

const campaignDispatchWorker = new Worker(
  'campaign-dispatch',
  async (job: Job<CampaignJob>) => {
    const { tenantId, campaignId } = job.data;
    const BATCH_SIZE = 50;

    const { data: campaign, error: campErr } = await serviceRoleClient
      .from('campaigns')
      .select('*, template:message_templates(content)')
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)
      .single();

    if (campErr || !campaign) {
      logger.warn({ campaignId }, 'Campaign not found for dispatch');
      return;
    }
    if (!['draft', 'scheduled'].includes(campaign.status)) return;

    await serviceRoleClient
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', campaignId);

    const templateContent = (campaign.template as { content: string } | null)?.content ?? campaign.name;

    let offset = 0;
    let totalSent = 0;
    let totalFailed = 0;

    while (true) {
      const { data: recipients, error: recErr } = await serviceRoleClient
        .from('campaign_recipients')
        .select('id, contact_id')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .range(offset, offset + BATCH_SIZE - 1);

      if (recErr || !recipients || recipients.length === 0) break;

      const now = new Date().toISOString();
      for (const recipient of recipients as Array<{ id: number; contact_id: number }>) {
        try {
          await serviceRoleClient.from('messages').insert({
            tenant_id:           tenantId,
            contact_id:          recipient.contact_id,
            whatsapp_account_id: campaign.whatsapp_account_id,
            campaign_id:         campaignId,
            direction:           'outbound',
            content:             templateContent,
            status:              'pending',
            is_read:             true,
            sent_at:             now,
          });
          totalSent++;
        } catch {
          await serviceRoleClient
            .from('campaign_recipients')
            .update({ status: 'failed', error_message: 'Failed to queue' })
            .eq('id', recipient.id);
          totalFailed++;
        }
      }

      offset += BATCH_SIZE;
      if (recipients.length < BATCH_SIZE) break;
    }

    await serviceRoleClient
      .from('campaigns')
      .update({
        status:       'completed',
        completed_at: new Date().toISOString(),
        sent_count:   totalSent,
        failed_count: totalFailed,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', campaignId);

    logger.info({ campaignId, totalSent, totalFailed }, 'Campaign dispatch complete');
  },
  { ...connection, concurrency: 5 }
);

// ── WEBHOOK PROCESS WORKER ───────────────────────────────────────────────────

const webhookWorker = new Worker(
  'webhook-process',
  async (job: Job<WebhookJob>) => {
    const { provider, payload, receivedAt } = job.data;
    logger.info({ provider, receivedAt, jobId: job.id }, 'Processing webhook');

    if (provider === 'meta') {
      const p = payload as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              messages?: Array<{ id: string; from: string; text?: { body: string }; type: string }>;
              statuses?: Array<{ id: string; status: string; timestamp: string }>;
              metadata?: { phone_number_id: string };
            };
          }>;
        }>;
      };

      for (const entry of p.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const val = change.value;
          if (!val) continue;

          for (const msg of val.messages ?? []) {
            logger.info({ msgId: msg.id, from: msg.from }, 'Inbound WhatsApp message');
            // Contact resolution + message insert for inbound messages would be implemented here
          }

          for (const status of val.statuses ?? []) {
            const st = status.status as 'sent' | 'delivered' | 'read' | 'failed';
            if (!['sent', 'delivered', 'read', 'failed'].includes(st)) continue;

            // Query parent messages table — PG routes to correct monthly partition
            const { data: msgs } = await serviceRoleClient
              .from('messages')
              .select('id, sent_at')
              .eq('external_message_id', status.id)
              .limit(1);

            if (msgs?.[0]) {
              await messagesRepository.updateStatus(msgs[0].id, st, {
                ...(st === 'delivered' && { deliveredAt: new Date(parseInt(status.timestamp) * 1000).toISOString() }),
                ...(st === 'read'      && { readAt:      new Date(parseInt(status.timestamp) * 1000).toISOString() }),
              });
            }
          }
        }
      }
    }
  },
  { ...connection, concurrency: 10 }
);

// ── API LOG WORKER (async DB insert from queue) ───────────────────────────────

const apiLogWorker = new Worker(
  'api-log',
  async (job: Job<{
    tenant_id: number | null;
    user_id: string | null;
    api_key_id: number | null;
    endpoint: string;
    method: string;
    status_code: number;
    response_time_ms: number;
    request_size_bytes: number | null;
    response_size_bytes: number | null;
    ip_address: string | null;
    error_message: string | null;
    created_at: string;
  }>) => {
    const { error } = await serviceRoleClient.from('api_logs').insert(job.data);
    if (error) logger.warn({ error }, 'api_log insert failed in worker');
  },
  { ...connection, concurrency: 30 }
);

// ── WORKER ERROR HANDLERS ─────────────────────────────────────────────────────

for (const worker of [sendMessageWorker, campaignDispatchWorker, webhookWorker, apiLogWorker]) {
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, `Worker job failed: ${job?.name}`);
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });
}

// ── START ─────────────────────────────────────────────────────────────────────

async function startWorkers() {
  await connectRedis();
  logger.info('Workers started (send-message, campaign-dispatch, webhook-process, api-log)');

  const shutdown = async (signal: string) => {
    logger.info(`${signal} — shutting down workers`);
    await Promise.all([
      sendMessageWorker.close(),
      campaignDispatchWorker.close(),
      webhookWorker.close(),
      apiLogWorker.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

startWorkers().catch((err) => {
  logger.fatal({ err }, 'Workers failed to start');
  process.exit(1);
});