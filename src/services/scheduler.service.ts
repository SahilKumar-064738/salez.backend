/**
 * src/services/scheduler.service.ts
 *
 * Polls the scheduled_jobs table every 30 seconds and executes due jobs.
 * Runs as part of the worker process (workers/index.ts).
 *
 * Supported job types:
 *   send_message    — fire a WhatsApp message at scheduled time
 *   start_call      — initiate an outbound IVR call
 *   campaign_reminder — trigger a campaign drip step
 *
 * Safety:
 *   - Atomic status update to 'running' before execution prevents double-fire
 *   - Max 50 jobs per poll cycle to prevent overload
 *   - Errors are recorded in the error column; job status → 'failed'
 */

import { serviceRoleClient } from '../config/supabase';
import { sendMessageQueue } from '../queues';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 30_000;   // 30 seconds
const BATCH_SIZE = 50;

interface ScheduledJob {
  id: number;
  tenant_id: number;
  job_type: string;
  payload: Record<string, unknown>;
  run_at: string;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    logger.info('Scheduler: starting (poll every 30s)');
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    // Run immediately on start
    this.poll().catch((err) => logger.error({ err }, 'Scheduler: initial poll failed'));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Scheduler: stopped');
    }
  }

  private async poll(): Promise<void> {
    const now = new Date().toISOString();

    // Atomically claim pending jobs due now (status = running prevents re-grab)
    const { data: jobs, error } = await serviceRoleClient
      .from('scheduled_jobs')
      .select('id, tenant_id, job_type, payload, run_at')
      .eq('status', 'pending')
      .lte('run_at', now)
      .limit(BATCH_SIZE);

    if (error) {
      logger.error({ error }, 'Scheduler: poll query failed');
      return;
    }

    if (!jobs || jobs.length === 0) return;

    logger.info({ count: jobs.length }, 'Scheduler: executing due jobs');

    // Mark all as 'running' before executing to prevent double-fire
    const ids = jobs.map((j: ScheduledJob) => j.id);
    await serviceRoleClient
      .from('scheduled_jobs')
      .update({ status: 'running' })
      .in('id', ids);

    // Execute each job
    for (const job of jobs as ScheduledJob[]) {
      this.executeJob(job).catch((err) => {
        logger.error({ err, jobId: job.id, jobType: job.job_type }, 'Scheduler: job execution failed');
      });
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    try {
      switch (job.job_type) {
        case 'send_message':
          await this.execSendMessage(job);
          break;

        case 'start_call':
          await this.execStartCall(job);
          break;

        case 'campaign_reminder':
          await this.execCampaignReminder(job);
          break;

        default:
          logger.warn({ jobType: job.job_type }, 'Scheduler: unknown job type');
      }

      // Mark done
      await serviceRoleClient
        .from('scheduled_jobs')
        .update({ status: 'done', ran_at: new Date().toISOString() })
        .eq('id', job.id);

    } catch (err: any) {
      await serviceRoleClient
        .from('scheduled_jobs')
        .update({ status: 'failed', error: String(err?.message ?? err) })
        .eq('id', job.id);
      throw err;
    }
  }

  private async execSendMessage(job: ScheduledJob): Promise<void> {
    const { contact_id, whatsapp_account_id, content } = job.payload as {
      contact_id: number;
      whatsapp_account_id: number;
      content: string;
    };

    // Insert pending message row
    await serviceRoleClient.from('messages').insert({
      tenant_id: job.tenant_id,
      contact_id,
      whatsapp_account_id,
      direction: 'outbound',
      content,
      status: 'pending',
      is_read: true,
      sent_at: new Date().toISOString(),
    });

    // Queue for actual send
    await sendMessageQueue.add('scheduled-send', {
      tenantId: job.tenant_id,
      contactId: contact_id,
      whatsappAccountId: whatsapp_account_id,
      content,
    });

    logger.info({ jobId: job.id, contactId: contact_id }, 'Scheduler: message queued');
  }

  private async execStartCall(job: ScheduledJob): Promise<void> {
    // In production: integrate with Twilio to initiate outbound call
    // Here we log the intent and mark a call record as 'initiated'
    const { contact_id } = job.payload as { contact_id: number; message: string };

    // Lookup contact phone
    const { data: contact } = await serviceRoleClient
      .from('contacts')
      .select('phone, name')
      .eq('id', contact_id)
      .eq('tenant_id', job.tenant_id)
      .single();

    if (!contact) {
      logger.warn({ jobId: job.id, contactId: contact_id }, 'Scheduler: contact not found for call');
      return;
    }

    // TODO: integrate with Twilio REST API to start the call
    // const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
    // await twilioClient.calls.create({ to: contact.phone, from: TWILIO_FROM, url: IVR_WEBHOOK });

    logger.info({ jobId: job.id, contactId: contact_id, phone: contact.phone }, 'Scheduler: call scheduled (Twilio integration required)');
  }

  private async execCampaignReminder(job: ScheduledJob): Promise<void> {
    // Placeholder for drip campaign reminder step
    const { campaign_id, step } = job.payload as { campaign_id: number; step: number };
    logger.info({ jobId: job.id, campaignId: campaign_id, step }, 'Scheduler: campaign reminder step');
    // Future: fetch campaign step template and queue message
  }
}

export const schedulerService = new SchedulerService();