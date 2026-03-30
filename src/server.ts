import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { env } from './config/env';
import { connectRedis, disconnectRedis } from './config/redis';
import { closeAllQueues } from './queues';
import { logger } from './utils/logger';
import { errorHandler, notFound } from './middlewares/errorHandler.middleware';
import { globalRateLimit } from './middlewares/rateLimit.middleware';
import { apiLogMiddleware } from './middlewares/apiLog.middleware';
import {
  authRouter,
  contactsRouter,
  messagesRouter,
  webhooksRouter,
  campaignsRouter,
  whatsappRouter,
  apiKeysRouter,
  callsRouter,
  analyticsRouter,
  settingsRouter,
  adminRouter,
} from './routes';

const app = express();

// ── TRUST PROXY ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── SECURITY ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'Accept'
],
}));

// ── BODY PARSING ──────────────────────────────────────────────────────────────
const API = `/api/${env.API_VERSION}`;

// Webhooks need raw Buffer for HMAC signature verification
app.use(`${API}/webhooks`, express.raw({ type: '*/*', limit: '5mb' }));

// JSON for everything else
app.use((req: Request, res: Response, next: express.NextFunction) => {
  if (req.path.startsWith(`${API}/webhooks`)) return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
app.use('/api/', globalRateLimit);

// ── REQUEST TIMING + STRUCTURED LOGGING ──────────────────────────────────────
app.use((req: Request, res: Response, next: express.NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    });
  });
  next();
});

// ── API LOG TO DB ─────────────────────────────────────────────────────────────
app.use(`${API}/`, apiLogMiddleware);

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: env.API_VERSION,
    env: env.NODE_ENV,
  });
});

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use(`${API}/webhooks`,          webhooksRouter);
app.use(`${API}/auth`,              authRouter);
app.use(`${API}/contacts`,          contactsRouter);
app.use(`${API}/messages`,          messagesRouter);
app.use(`${API}/campaigns`,         campaignsRouter);
app.use(`${API}/whatsapp-accounts`, whatsappRouter);
app.use(`${API}/api-keys`,          apiKeysRouter);
app.use(`${API}/calls`,             callsRouter);
app.use(`${API}/analytics`,         analyticsRouter);
app.use(`${API}/settings`,          settingsRouter);
app.use(`${API}/admin`,             adminRouter);

// ── ERROR HANDLING ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── START ─────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await connectRedis();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Server running on port ${env.PORT}`);
    logger.info(`📡 Base: ${API}`);
    logger.info(`🌍 Env: ${env.NODE_ENV}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} — graceful shutdown`);
    server.close(async () => {
      await closeAllQueues();
      await disconnectRedis();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 15_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});

export default app;