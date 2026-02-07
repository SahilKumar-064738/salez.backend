import { Router, Request, Response } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all contacts
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { stage, search, page = 1, limit = 50 } = req.query;
  const businessId = req.user!.businessId;
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT c.*, 
           COUNT(*) OVER() as total_count,
           (SELECT COUNT(*) FROM messages WHERE contact_id = c.id) as message_count,
           (SELECT content FROM messages WHERE contact_id = c.id ORDER BY sent_at DESC LIMIT 1) as last_message
    FROM contacts c
    WHERE c.business_id = $1
  `;
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (stage) {
    query += ` AND c.stage = $${paramIndex}`;
    params.push(stage);
    paramIndex++;
  }

  if (search) {
    query += ` AND (c.name ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  query += ` ORDER BY c.last_active DESC NULLS LAST, c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(Number(limit), offset);

  const result = await pool.query(query, params);

  res.json({
    contacts: result.rows.map(row => {
      const { total_count, ...contact } = row;
      return contact;
    }),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total: result.rows[0]?.total_count || 0
    }
  });
}));

// Get single contact
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT c.*, 
            (SELECT COUNT(*) FROM messages WHERE contact_id = c.id) as message_count,
            (SELECT json_agg(tag) FROM contact_tags WHERE contact_id = c.id) as tags
     FROM contacts c
     WHERE c.id = $1 AND c.business_id = $2`,
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  res.json(result.rows[0]);
}));

// Create contact
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { phone, name, stage = 'New' } = req.body;
  const businessId = req.user!.businessId;

  if (!phone) {
    throw new AppError('Phone number is required', 400);
  }

  // Check if contact already exists
  const existing = await pool.query(
    'SELECT id FROM contacts WHERE business_id = $1 AND phone = $2',
    [businessId, phone]
  );

  if (existing.rows.length > 0) {
    throw new AppError('Contact already exists', 400);
  }

  const result = await pool.query(
    'INSERT INTO contacts (business_id, phone, name, stage, last_active) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
    [businessId, phone, name, stage]
  );

  res.status(201).json(result.rows[0]);
}));

// Update contact
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, phone, stage } = req.body;
  const businessId = req.user!.businessId;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (phone !== undefined) {
    updates.push(`phone = $${paramIndex++}`);
    values.push(phone);
  }
  if (stage !== undefined) {
    updates.push(`stage = $${paramIndex++}`);
    values.push(stage);
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  values.push(id, businessId);

  const result = await pool.query(
    `UPDATE contacts SET ${updates.join(', ')} 
     WHERE id = $${paramIndex++} AND business_id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  res.json(result.rows[0]);
}));

// Delete contact
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'DELETE FROM contacts WHERE id = $1 AND business_id = $2 RETURNING id',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  res.json({ message: 'Contact deleted successfully' });
}));

// Add tag to contact
router.post('/:id/tags', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { tag } = req.body;
  const businessId = req.user!.businessId;

  if (!tag) {
    throw new AppError('Tag is required', 400);
  }

  // Verify contact belongs to business
  const contactCheck = await pool.query(
    'SELECT id FROM contacts WHERE id = $1 AND business_id = $2',
    [id, businessId]
  );

  if (contactCheck.rows.length === 0) {
    throw new AppError('Contact not found', 404);
  }

  await pool.query(
    'INSERT INTO contact_tags (business_id, contact_id, tag) VALUES ($1, $2, $3)',
    [businessId, id, tag]
  );

  res.status(201).json({ message: 'Tag added successfully' });
}));

// Remove tag from contact
router.delete('/:id/tags/:tag', asyncHandler(async (req: Request, res: Response) => {
  const { id, tag } = req.params;
  const businessId = req.user!.businessId;

  await pool.query(
    'DELETE FROM contact_tags WHERE business_id = $1 AND contact_id = $2 AND tag = $3',
    [businessId, id, tag]
  );

  res.json({ message: 'Tag removed successfully' });
}));

export default router;
