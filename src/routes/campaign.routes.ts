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
  const { name, templateId, scheduledAt } = req.body;
  const businessId = req.user!.businessId;

  if (!name || !templateId) {
    throw new AppError('Name and template ID are required', 400);
  }

  const result = await pool.query(
    'INSERT INTO campaigns (business_id, template_id, name, scheduled_at, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [businessId, templateId, name, scheduledAt || null, 'draft']
  );

  res.status(201).json(result.rows[0]);
}));

export default router;
