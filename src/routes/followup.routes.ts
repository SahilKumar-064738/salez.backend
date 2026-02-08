import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { followUpService } from '../services/followup.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/followup/analyze/:messageId
 * Analyze a message for deal status
 */
router.post('/analyze/:messageId', authenticate, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    
    await followUpService.analyzeMessageForDealStatus(parseInt(messageId));
    
    res.json({ 
      message: 'Message analyzed successfully',
      messageId 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/followup/process
 * Manually trigger follow-up processing
 */
router.post('/process', authenticate, async (req, res, next) => {
  try {
    await followUpService.processPendingFollowUps();
    
    res.json({ 
      message: 'Follow-up processing completed' 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/followup/stats
 * Get follow-up statistics for the business
 */
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    
    const stats = await followUpService.getFollowUpStats(businessId);
    
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/followup/hot-leads
 * Get contacts that are hot leads (ready for conversion)
 */
router.get('/hot-leads', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    
    const hotLeads = await followUpService.identifyHotLeads(businessId);
    
    res.json({ 
      count: hotLeads.length,
      leads: hotLeads 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/followup/custom-rule
 * Create a custom follow-up rule
 */
router.post('/custom-rule', authenticate, async (req, res, next) => {
  try {
    const businessId = req.user!.businessId;
    const { stage, hoursAfterLastMessage, messageTemplate, maxFollowUps } = req.body;

    if (!stage || !hoursAfterLastMessage || !messageTemplate || !maxFollowUps) {
      return res.status(400).json({ 
        error: 'Missing required fields: stage, hoursAfterLastMessage, messageTemplate, maxFollowUps' 
      });
    }

    await followUpService.createCustomFollowUpRule(businessId, {
      stage,
      hoursAfterLastMessage: parseInt(hoursAfterLastMessage),
      messageTemplate,
      maxFollowUps: parseInt(maxFollowUps)
    });

    res.status(201).json({ 
      message: 'Custom follow-up rule created successfully' 
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/followup/sentiment/:contactId
 * Analyze conversation sentiment for a contact
 */
router.get('/sentiment/:contactId', authenticate, async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    const sentiment = await followUpService.analyzeConversationSentiment(
      parseInt(contactId)
    );
    
    res.json({ 
      contactId,
      sentiment 
    });
  } catch (error) {
    next(error);
  }
});

export default router;