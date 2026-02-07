import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Webhook endpoint (no auth required, but should verify webhook signature)
router.post('/webhook', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Webhook verification (Meta WhatsApp)
  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verified');
    res.status(200).send(challenge);
    return;
  }

  // Handle incoming messages
  if (req.body.object === 'whatsapp_business_account') {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    
    if (changes?.field === 'messages') {
      // Extract business ID from webhook (you may need to map phone_number_id to business_id)
      // For now, we'll need to find business by phone number or use a mapping table
      const phoneNumberId = changes.value?.metadata?.phone_number_id;
      
      if (phoneNumberId) {
        const accountResult = await pool.query(
          'SELECT business_id FROM whatsapp_accounts WHERE phone_number_id = $1 LIMIT 1',
          [phoneNumberId]
        );

        if (accountResult.rows.length > 0) {
          const businessId = accountResult.rows[0].business_id;
          await whatsappService.processIncomingMessage(req.body, businessId);
        }
      }
    }

    res.status(200).json({ success: true });
  } else {
    res.status(404).json({ error: 'Invalid webhook data' });
  }
}));

// All other routes require authentication
router.use(authenticate);

// List WhatsApp accounts for business
router.get('/accounts', asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'SELECT id, phone_number, status, connected_at FROM whatsapp_accounts WHERE business_id = $1 ORDER BY connected_at DESC',
    [businessId]
  );

  res.json(result.rows);
}));

// Get WhatsApp account by ID
router.get('/accounts/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT id, phone_number, status, connected_at 
     FROM whatsapp_accounts 
     WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('WhatsApp account not found', 404);
  }

  // Don't return API token for security
  const account = result.rows[0];
  res.json(account);
}));

// Connect/Add WhatsApp account
router.post('/accounts', asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber, apiToken, phoneNumberId } = req.body;
  const businessId = req.user!.businessId;

  if (!phoneNumber || !apiToken) {
    throw new AppError('Phone number and API token are required', 400);
  }

  // Check if account already exists
  const existing = await pool.query(
    'SELECT id FROM whatsapp_accounts WHERE business_id = $1 AND phone_number = $2',
    [businessId, phoneNumber]
  );

  if (existing.rows.length > 0) {
    throw new AppError('WhatsApp account already exists for this phone number', 400);
  }

  const result = await pool.query(
    `INSERT INTO whatsapp_accounts (business_id, phone_number, api_token, phone_number_id, status, connected_at)
     VALUES ($1, $2, $3, $4, 'active', NOW()) RETURNING id, phone_number, status, connected_at`,
    [businessId, phoneNumber, apiToken, phoneNumberId || null]
  );

  res.status(201).json(result.rows[0]);
}));

// Update WhatsApp account
router.put('/accounts/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { apiToken, phoneNumberId, status } = req.body;
  const businessId = req.user!.businessId;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (apiToken !== undefined) {
    updates.push(`api_token = $${paramIndex++}`);
    values.push(apiToken);
  }
  if (phoneNumberId !== undefined) {
    updates.push(`phone_number_id = $${paramIndex++}`);
    values.push(phoneNumberId);
  }
  if (status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(status);
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  values.push(id, businessId);

  const result = await pool.query(
    `UPDATE whatsapp_accounts SET ${updates.join(', ')} 
     WHERE id = $${paramIndex++} AND business_id = $${paramIndex}
     RETURNING id, phone_number, status, connected_at`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('WhatsApp account not found', 404);
  }

  res.json(result.rows[0]);
}));

// Delete/Disconnect WhatsApp account
router.delete('/accounts/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'DELETE FROM whatsapp_accounts WHERE id = $1 AND business_id = $2 RETURNING id',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('WhatsApp account not found', 404);
  }

  res.json({ message: 'WhatsApp account disconnected successfully' });
}));

export default router;
