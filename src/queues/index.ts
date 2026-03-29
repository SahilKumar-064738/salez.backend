import { Queue } from 'bullmq';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

function makeConn() {
  return { connection: getRedis() };
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

export const sendMessageQueue      = new Queue('send-message',      { ...makeConn(), defaultJobOptions });
export const webhookProcessQueue   = new Queue('webhook-process',   { ...makeConn(), defaultJobOptions: { ...defaultJobOptions, attempts: 5 } });
export const campaignDispatchQueue = new Queue('campaign-dispatch', { ...makeConn(), defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });
export const apiLogQueue           = new Queue('api-log',           { ...makeConn(), defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });

export async function closeAllQueues(): Promise<void> {
  try {
    await Promise.all([
      sendMessageQueue.close(),
      webhookProcessQueue.close(),
      campaignDispatchQueue.close(),
      apiLogQueue.close(),
    ]);
    logger.info('All queues closed');
  } catch (err) {
    logger.error({ err }, 'Error closing queues');
  }
}
