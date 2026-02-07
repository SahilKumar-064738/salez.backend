import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { whatsappService } from '../services/whatsapp.service.js';

const router = Router();
router.use(authenticate);

// List all messages
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { contactId, page = 1, limit = 50 } = req.query;
  const businessId = req.user!.businessId;
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT m.*, 
           c.name as contact_name,
           c.phone as contact_phone,
           COUNT(*) OVER() as total_count
    FROM messages m
    JOIN contacts c ON m.contact_id = c.id
    WHERE m.business_id = $1
  `;
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (contactId) {
    query += ` AND m.contact_id = $${paramIndex}`;
    params.push(contactId);
    paramIndex++;
  }

  query += ` ORDER BY m.sent_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(Number(limit), offset);

  const result = await pool.query(query, params);

  res.json({
    messages: result.rows.map(row => {
      const { total_count, ...message } = row;
      return message;
    }),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total: result.rows[0]?.total_count || 0
    }
  });
}));

// Get messages for a contact (must come before /:id)
router.get('/contact/:contactId', asyncHandler(async (req: Request, res: Response) => {
  const { contactId } = req.params;
  const businessId = req.user!.businessId;

  // Verify contact belongs to business
  const contactCheck = await pool.query(
    'SELECT id FROM contacts WHERE id = $1 AND business_id = $2',
    [contactId, businessId]
  );

  if (contactCheck.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  const result = await pool.query(
    `SELECT * FROM messages 
     WHERE contact_id = $1 
     ORDER BY sent_at ASC`,
    [contactId]
  );

  res.json(result.rows);
}));

// Get message by ID
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT m.*, 
            c.name as contact_name,
            c.phone as contact_phone
     FROM messages m
     JOIN contacts c ON m.contact_id = c.id
     WHERE m.id = $1 AND m.business_id = $2`,
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Message not found', 404);
  }

  res.json(result.rows[0]);
}));

// Send message
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { contactId, content, whatsappAccountId } = req.body;
  const businessId = req.user!.businessId;

  if (!contactId || !content) {
    throw new AppError('Contact ID and content are required', 400);
  }

  // Verify contact and get phone number
  const contactCheck = await pool.query(
    'SELECT id, phone FROM contacts WHERE id = $1 AND business_id = $2',
    [contactId, businessId]
  );

  if (contactCheck.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  const contact = contactCheck.rows[0];

  // Send message via WhatsApp API
  let whatsappAccountIdToUse = whatsappAccountId;
  const whatsappResult = await whatsappService.sendMessage(
    businessId,
    contact.phone,
    content,
    whatsappAccountIdToUse
  );

  // Get the WhatsApp account ID that was used
  if (!whatsappAccountIdToUse) {
    const accountResult = await pool.query(
      `SELECT id FROM whatsapp_accounts 
       WHERE business_id = $1 AND status = 'active' 
       ORDER BY connected_at DESC LIMIT 1`,
      [businessId]
    );
    whatsappAccountIdToUse = accountResult.rows[0]?.id || null;
  }

  // Save message to database
  const result = await pool.query(
    `INSERT INTO messages (business_id, whatsapp_account_id, contact_id, direction, content, status)
     VALUES ($1, $2, $3, 'outbound', $4, $5)
     RETURNING *`,
    [
      businessId,
      whatsappAccountIdToUse,
      contactId,
      'outbound',
      content,
      whatsappResult.success ? 'sent' : 'failed'
    ]
  );

  // Update contact last_active
  await pool.query(
    'UPDATE contacts SET last_active = NOW() WHERE id = $1',
    [contactId]
  );

  if (!whatsappResult.success) {
    throw new AppError(whatsappResult.error || 'Failed to send WhatsApp message', 500);
  }

  res.status(201).json({
    ...result.rows[0],
    whatsappMessageId: whatsappResult.messageId
  });
}));

export default router;
