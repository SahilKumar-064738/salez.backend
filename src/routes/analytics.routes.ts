import { Router } from 'express';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Get analytics summary
router.get('/summary', asyncHandler(async (req, res) => {
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

  // Total messages
  const messagesResult = await pool.query(
    `SELECT 
       COUNT(*) as total,
       COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as sent,
       COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as received
     FROM messages 
     WHERE business_id = $1`,
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

  // Messages in last 30 days
  const recentMessagesResult = await pool.query(
    `SELECT COUNT(*) as total 
     FROM messages 
     WHERE business_id = $1 
     AND sent_at >= NOW() - INTERVAL '30 days'`,
    [businessId]
  );

  res.json({
    totalContacts: parseInt(contactsResult.rows[0]?.total || '0'),
    contactsByStage: stagesResult.rows,
    totalMessages: parseInt(messagesResult.rows[0]?.total || '0'),
    messagesSent: parseInt(messagesResult.rows[0]?.sent || '0'),
    messagesReceived: parseInt(messagesResult.rows[0]?.received || '0'),
    activeCampaigns: parseInt(campaignsResult.rows[0]?.total || '0'),
    messagesLast30Days: parseInt(recentMessagesResult.rows[0]?.total || '0')
  });
}));

// Get message analytics
router.get('/messages', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;
  const { startDate, endDate } = req.query;

  let dateFilter = '';
  const params: any[] = [businessId];
  let paramIndex = 2;

  if (startDate && endDate) {
    dateFilter = ` AND sent_at >= $${paramIndex} AND sent_at <= $${paramIndex + 1}`;
    params.push(startDate, endDate);
    paramIndex += 2;
  } else {
    // Default to last 30 days
    dateFilter = ` AND sent_at >= NOW() - INTERVAL '30 days'`;
  }

  // Messages by direction
  const directionResult = await pool.query(
    `SELECT direction, COUNT(*) as count
     FROM messages
     WHERE business_id = $1${dateFilter}
     GROUP BY direction`,
    params
  );

  // Messages by status
  const statusResult = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM messages
     WHERE business_id = $1${dateFilter}
     GROUP BY status`,
    params
  );

  // Messages by day (last 30 days)
  const dailyResult = await pool.query(
    `SELECT DATE(sent_at) as date, COUNT(*) as count
     FROM messages
     WHERE business_id = $1${dateFilter}
     GROUP BY DATE(sent_at)
     ORDER BY date DESC`,
    params
  );

  // Response rate (inbound messages / outbound messages)
  const responseRateResult = await pool.query(
    `SELECT 
       COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as sent,
       COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as received
     FROM messages
     WHERE business_id = $1${dateFilter}`,
    params
  );

  const sent = parseInt(responseRateResult.rows[0]?.sent || 0);
  const received = parseInt(responseRateResult.rows[0]?.received || 0);
  const responseRate = sent > 0 ? ((received / sent) * 100).toFixed(2) : '0.00';

  res.json({
    byDirection: directionResult.rows,
    byStatus: statusResult.rows,
    daily: dailyResult.rows,
    responseRate: parseFloat(responseRate),
    totalSent: sent,
    totalReceived: received
  });
}));

// Get campaign analytics by ID (must come before /campaigns)
router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.user!.businessId;

  // First verify campaign exists and belongs to business
  const campaignCheck = await pool.query(
    'SELECT id FROM campaigns WHERE id = $1 AND business_id = $2',
    [id, businessId]
  );

  if (campaignCheck.rows.length === 0) {
    throw new AppError('Campaign not found', 404);
  }

  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_sent,
       COALESCE(SUM(CASE WHEN delivered THEN 1 ELSE 0 END), 0) as delivered,
       COALESCE(SUM(CASE WHEN replied THEN 1 ELSE 0 END), 0) as replied
     FROM campaign_logs cl
     WHERE cl.campaign_id = $1`,
    [id]
  );

  res.json({
    total_sent: parseInt(result.rows[0]?.total_sent || 0),
    delivered: parseInt(result.rows[0]?.delivered || 0),
    replied: parseInt(result.rows[0]?.replied || 0)
  });
}));

// Get campaign analytics (general, not by ID)
router.get('/campaigns', asyncHandler(async (req, res) => {
  const businessId = req.user!.businessId;

  // Campaigns by status
  const statusResult = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM campaigns
     WHERE business_id = $1
     GROUP BY status`,
    [businessId]
  );

  // Campaign performance summary
  const performanceResult = await pool.query(
    `SELECT 
       COUNT(*) as total_campaigns,
       SUM(target_count) as total_targeted,
       SUM(sent_count) as total_sent,
       SUM(delivered_count) as total_delivered,
       SUM(failed_count) as total_failed
     FROM campaigns
     WHERE business_id = $1`,
    [businessId]
  );

  // Recent campaigns
  const recentResult = await pool.query(
    `SELECT id, name, status, target_count, sent_count, delivered_count, failed_count, created_at
     FROM campaigns
     WHERE business_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [businessId]
  );

  res.json({
    byStatus: statusResult.rows,
    summary: performanceResult.rows[0],
    recentCampaigns: recentResult.rows
  });
}));

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
    totalContacts: parseInt(contactsResult.rows[0]?.total || '0'),
    contactsByStage: stagesResult.rows,
    messagesSent: parseInt(messagesResult.rows[0]?.total || '0'),
    activeCampaigns: parseInt(campaignsResult.rows[0]?.total || '0'),
    recentActivity: activityResult.rows
  });
}));

export default router;
