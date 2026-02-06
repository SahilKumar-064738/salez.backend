import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get messages for a contact
router.get('/contact/:contactId', asyncHandler(async (req, res) => {
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

// Send message
router.post('/', asyncHandler(async (req, res) => {
  const { contactId, content } = req.body;
  const businessId = req.user!.businessId;

  if (!contactId || !content) {
    throw new AppError('Contact ID and content are required', 400);
  }

  // Verify contact
  const contactCheck = await pool.query(
    'SELECT id FROM contacts WHERE id = $1 AND business_id = $2',
    [contactId, businessId]
  );

  if (contactCheck.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  const result = await pool.query(
    `INSERT INTO messages (business_id, contact_id, direction, content, status)
     VALUES ($1, $2, 'outbound', $3, 'sent')
     RETURNING *`,
    [businessId, contactId, content]
  );

  // Update contact last_active
  await pool.query(
    'UPDATE contacts SET last_active = NOW() WHERE id = $1',
    [contactId]
  );

  res.status(201).json(result.rows[0]);
}));

export default router;
