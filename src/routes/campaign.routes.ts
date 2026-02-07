// Campaign Routes
import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;
  const result = await pool.query(
    `SELECT c.*, t.name as template_name 
     FROM campaigns c 
     LEFT JOIN message_templates t ON c.template_id = t.id
     WHERE c.business_id = $1 
     ORDER BY c.scheduled_at DESC`,
    [businessId]
  );
  res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, templateId, scheduledAt, status } = req.body;
  const businessId = req.user!.businessId;

  if (!name || !templateId) {
    throw new AppError('Name and template ID are required', 400);
  }

  const result = await pool.query(
    'INSERT INTO campaigns (business_id, template_id, name, scheduled_at, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [businessId, templateId, name, scheduledAt || null, status || null]
  );

  res.status(201).json(result.rows[0]);
}));

// Get campaign by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT c.*, t.name as template_name, t.content as template_content
     FROM campaigns c 
     LEFT JOIN message_templates t ON c.template_id = t.id
     WHERE c.id = $1 AND c.business_id = $2`,
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Campaign not found', 404);
  }

  res.json(result.rows[0]);
}));

// Update campaign
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, templateId, scheduledAt, status } = req.body;
  const businessId = req.user!.businessId;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (templateId !== undefined) {
    updates.push(`template_id = $${paramIndex++}`);
    values.push(templateId);
  }
  if (scheduledAt !== undefined) {
    updates.push(`scheduled_at = $${paramIndex++}`);
    values.push(scheduledAt);
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
    `UPDATE campaigns SET ${updates.join(', ')} 
     WHERE id = $${paramIndex++} AND business_id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Campaign not found', 404);
  }

  res.json(result.rows[0]);
}));

// Delete campaign
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'DELETE FROM campaigns WHERE id = $1 AND business_id = $2 RETURNING id',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Campaign not found', 404);
  }

  res.json({ message: 'Campaign deleted successfully' });
}));

export default router;
