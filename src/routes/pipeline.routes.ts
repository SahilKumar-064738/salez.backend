import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get pipeline view (contacts grouped by stage)
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT 
       stage,
       json_agg(
         json_build_object(
           'id', id,
           'name', name,
           'phone', phone,
           'created_at', created_at,
           'last_active', last_active
         ) ORDER BY last_active DESC NULLS LAST, created_at DESC
       ) as contacts
     FROM contacts
     WHERE business_id = $1
     GROUP BY stage`,
    [businessId]
  );

  // Transform into pipeline format
  const pipeline: Record<string, any[]> = {};
  result.rows.forEach(row => {
    pipeline[row.stage] = row.contacts || [];
  });

  // Ensure all stages exist
  const stages = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  stages.forEach(stage => {
    if (!pipeline[stage]) {
      pipeline[stage] = [];
    }
  });

  res.json(pipeline);
}));

// Move contact to different stage
router.put('/move/:contactId', asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  const { stage } = req.body;
  const businessId = req.user!.businessId;

  if (!stage) {
    throw new AppError('Stage is required', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current stage
    const currentResult = await client.query(
      'SELECT stage FROM contacts WHERE id = $1 AND business_id = $2',
      [contactId, businessId]
    );

    if (currentResult.rows.length === 0) {
      throw new AppError('Contact not found', 404);
    }

    const fromStage = currentResult.rows[0].stage;

    // Update contact stage
    await client.query(
      'UPDATE contacts SET stage = $1 WHERE id = $2',
      [stage, contactId]
    );

    // Log the change
    await client.query(
      'INSERT INTO pipeline_history (business_id, contact_id, from_stage, to_stage) VALUES ($1, $2, $3, $4)',
      [businessId, contactId, fromStage, stage]
    );

    await client.query('COMMIT');

    res.json({ message: 'Contact moved successfully', fromStage, toStage: stage });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// Get pipeline history
router.get('/history/:contactId', asyncHandler(async (req, res) => {
  const { contactId } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT * FROM pipeline_history 
     WHERE contact_id = $1 AND business_id = $2 
     ORDER BY changed_at DESC`,
    [contactId, businessId]
  );

  res.json(result.rows);
}));

export default router;
