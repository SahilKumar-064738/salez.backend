import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './config/database.js';
import authRoutes from './routes/auth.routes.js';
import contactRoutes from './routes/contact.routes.js';
import messageRoutes from './routes/message.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import templateRoutes from './routes/template.routes.js';
import automationRoutes from './routes/automation.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import pipelineRoutes from './routes/pipeline.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import billingRoutes from './routes/billing.routes.js';
import followupRoutes from './routes/followup.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { apiLimiter, authLimiter, webhookLimiter } from './middleware/rateLimiter.js';
import { startCampaignScheduler } from './services/campaign.executor.js';
import { followUpService } from './services/followup.service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://salezonline.netlify.app',
    ];

app.use(
  cors({
    origin: (origin, callback) => {
      // allow server-to-server, curl, mobile apps
      if (!origin) return callback(null, true);

      if (corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 🔴 THIS IS CRITICAL
app.options('*', cors());

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// API Routes with specific rate limiters
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/whatsapp', whatsappRoutes); // Webhook has its own limiter in the route file
app.use('/api/billing', billingRoutes);
app.use('/api/followup', followupRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
  
  // Start campaign scheduler (checks every 5 minutes)
  startCampaignScheduler(5);
  
  // Start follow-up automation scheduler
  followUpService.startFollowUpScheduler();
});

// Graceful shutdown
let campaignScheduler: ReturnType<typeof setInterval>;

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing server...');
  
  // Stop campaign scheduler
  if (campaignScheduler) {
    clearInterval(campaignScheduler);
  }
  
  await pool.end();
  process.exit(0);
});