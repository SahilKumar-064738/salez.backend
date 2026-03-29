import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV:         z.enum(['development', 'test', 'production']).default('development'),
  PORT:             z.coerce.number().default(4000),
  API_VERSION:      z.string().default('v1'),
  ALLOWED_ORIGINS:  z.string().default('http://localhost:3000'),

  SUPABASE_URL:              z.string().url(),
  SUPABASE_ANON_KEY:         z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Must be ≥32 chars. Generate: openssl rand -hex 32
  ENCRYPTION_SECRET: z.string().min(32),

  META_APP_SECRET:   z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),

  TWILIO_AUTH_TOKEN: z.string().optional(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
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