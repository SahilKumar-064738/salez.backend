import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// List automation rules
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;
  const result = await pool.query(
    'SELECT * FROM automation_rules WHERE business_id = $1 ORDER BY id DESC',
    [businessId]
  );
  
  // Parse JSON fields
  const rules = result.rows.map(rule => {
    try {
      return {
        ...rule,
        condition: typeof rule.condition === 'string' ? JSON.parse(rule.condition) : rule.condition,
        action: typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action
      };
    } catch (error) {
      // If JSON parsing fails, return original values
      return rule;
    }
  });
  
  res.json(rules);
}));

// Get automation rule by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'SELECT * FROM automation_rules WHERE id = $1 AND business_id = $2',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Automation rule not found', 404);
  }

  // Parse JSON fields if they exist
  const rule = result.rows[0];
  try {
    rule.condition = typeof rule.condition === 'string' ? JSON.parse(rule.condition) : rule.condition;
    rule.action = typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action;
  } catch (error) {
    // If JSON parsing fails, keep original values
  }

  res.json(rule);
}));

// Create automation rule
router.post('/', asyncHandler(async (req, res) => {
  const { trigger, condition, action, delayMinutes = 0 } = req.body;
  const businessId = req.user!.businessId;

  if (!trigger || !condition || !action) {
    throw new AppError('Trigger, condition, and action are required', 400);
  }

  const result = await pool.query(
    `INSERT INTO automation_rules (business_id, trigger, condition, action, delay_minutes) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      businessId, 
      trigger, 
      JSON.stringify(condition), 
      JSON.stringify(action),
      delayMinutes
    ]
  );

  // Parse JSON fields in response
  const rule = result.rows[0];
  try {
    rule.condition = typeof rule.condition === 'string' ? JSON.parse(rule.condition) : rule.condition;
    rule.action = typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action;
  } catch (error) {
    // If JSON parsing fails, keep original values
  }

  res.status(201).json(rule);
}));

// Update automation rule
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { trigger, condition, action, delayMinutes } = req.body;
  const businessId = req.user!.businessId;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (trigger !== undefined) {
    updates.push(`trigger = $${paramIndex++}`);
    values.push(trigger);
  }
  if (condition !== undefined) {
    updates.push(`condition = $${paramIndex++}`);
    values.push(JSON.stringify(condition));
  }
  if (action !== undefined) {
    updates.push(`action = $${paramIndex++}`);
    values.push(JSON.stringify(action));
  }
  if (delayMinutes !== undefined) {
    updates.push(`delay_minutes = $${paramIndex++}`);
    values.push(delayMinutes);
  }

  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  values.push(id, businessId);

  const result = await pool.query(
    `UPDATE automation_rules SET ${updates.join(', ')} 
     WHERE id = $${paramIndex++} AND business_id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new AppError('Automation rule not found', 404);
  }

  // Parse JSON fields in response
  const rule = result.rows[0];
  try {
    rule.condition = typeof rule.condition === 'string' ? JSON.parse(rule.condition) : rule.condition;
    rule.action = typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action;
  } catch (error) {
    // If JSON parsing fails, keep original values
  }

  res.json(rule);
}));

// Delete automation rule
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    'DELETE FROM automation_rules WHERE id = $1 AND business_id = $2 RETURNING id',
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Automation rule not found', 404);
  }

  res.json({ message: 'Automation rule deleted successfully' });
}));

export default router;
