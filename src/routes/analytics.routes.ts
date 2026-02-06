import { Router } from 'express';
import { pool } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get dashboard analytics
router.get('/dashboard', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;

  // Total contacts
  const contactsResult = await pool.query(
    'SELECT COUNT(*) as total FROM contacts WHERE business_id = $1',
    [businessId]
  );

  // Contacts by stage
  const stagesResult = await pool.query(
    `SELECT stage, COUNT(*) as count 
     FROM contacts 
     WHERE business_id = $1 
     GROUP BY stage`,
    [businessId]
  );

  // Messages sent (last 30 days)
  const messagesResult = await pool.query(
    `SELECT COUNT(*) as total 
     FROM messages 
     WHERE business_id = $1 
     AND sent_at >= NOW() - INTERVAL '30 days'`,
    [businessId]
  );

  // Active campaigns
  const campaignsResult = await pool.query(
    `SELECT COUNT(*) as total 
     FROM campaigns 
     WHERE business_id = $1 
     AND status IN ('active', 'scheduled')`,
    [businessId]
  );

  // Recent activity (last 7 days)
  const activityResult = await pool.query(
    `SELECT DATE(sent_at) as date, COUNT(*) as count
     FROM messages
     WHERE business_id = $1
     AND sent_at >= NOW() - INTERVAL '7 days'
     GROUP BY DATE(sent_at)
     ORDER BY date DESC`,
    [businessId]
  );

  res.json({
    totalContacts: parseInt(contactsResult.rows[0].total),
    contactsByStage: stagesResult.rows,
    messagesSent: parseInt(messagesResult.rows[0].total),
    activeCampaigns: parseInt(campaignsResult.rows[0].total),
    recentActivity: activityResult.rows
  });
}));

// Get campaign analytics
router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_sent,
       SUM(CASE WHEN delivered THEN 1 ELSE 0 END) as delivered,
       SUM(CASE WHEN replied THEN 1 ELSE 0 END) as replied
     FROM campaign_logs cl
     JOIN campaigns c ON cl.campaign_id = c.id
     WHERE cl.campaign_id = $1 AND c.business_id = $2`,
    [id, businessId]
  );

  res.json(result.rows[0]);
}));

export default router;
