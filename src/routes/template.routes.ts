import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get all templates
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'SELECT * FROM message_templates WHERE business_id = $1 ORDER BY name',
    [businessId]
  );

  res.json(result.rows);
}));

// Get template by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'SELECT * FROM message_templates WHERE id = $1 AND business_id = $2',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Template not found', 404);
  }

  res.json(result.rows[0]);
}));

// Create template
router.post('/', asyncHandler(async (req, res) => {
  const { name, content } = req.body;
  const businessId = req.user!.businessId;

  if (!name || !content) {
    throw new AppError('Name and content are required', 400);
  }

  const result = await pool.query(
    'INSERT INTO message_templates (business_id, name, content, status) VALUES ($1, $2, $3, $4) RETURNING *',
    [businessId, name, content, 'pending']
  );

  res.status(201).json(result.rows[0]);
}));

// Update template
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, content, status } = req.body;
  const businessId = req.user!.businessId;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (content) {
    updates.push(`content = $${paramIndex++}`);
    values.push(content);
  }
  if (status) {
    updates.push(`status = $${paramIndex++}`);
    values.push(status);
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  values.push(id, businessId);

  const result = await pool.query(
    `UPDATE message_templates SET ${updates.join(', ')} 
     WHERE id = $${paramIndex++} AND business_id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Template not found', 404);
  }

  res.json(result.rows[0]);
}));

// Delete template
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'DELETE FROM message_templates WHERE id = $1 AND business_id = $2 RETURNING id',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Template not found', 404);
  }

  res.json({ message: 'Template deleted successfully' });
}));

export default router;
