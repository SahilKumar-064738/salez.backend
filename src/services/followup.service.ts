import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { sendMessage } from './whatsapp.service.js';
import cron from 'node-cron';

interface Contact {
  id: number;
  business_id: number;
  phone: string;
  name: string | null;
  stage: string;
  last_active: Date | null;
}

interface Message {
  id: number;
  contact_id: number;
  content: string;
  direction: 'inbound' | 'outbound';
  sent_at: Date;
}

interface FollowUpRule {
  stage: string;
  hoursAfterLastMessage: number;
  messageTemplate: string;
  maxFollowUps: number;
}

/**
 * Intelligent Follow-Up Automation Service
 * Analyzes conversations to identify deal status and automates follow-ups
 */
class FollowUpAutomationService {
  
  // Deal detection keywords
  private readonly dealClosedKeywords = [
    'yes', 'sure', 'confirmed', 'deal', 'agreed', 'accept', 'buy', 'purchase',
    'order', 'booking', 'book', 'reserve', 'confirm', 'go ahead', 'proceed',
    'perfect', 'great', 'sounds good', 'count me in', 'i\'m in'
  ];

  private readonly dealLostKeywords = [
    'no thanks', 'not interested', 'no', 'cancel', 'nevermind', 'never mind',
    'too expensive', 'expensive', 'can\'t afford', 'not now', 'maybe later',
    'not for me', 'pass', 'decline', 'reject'
  ];

  private readonly needsFollowUpKeywords = [
    'thinking', 'maybe', 'consider', 'let me think', 'not sure', 'hmm',
    'i\'ll let you know', 'get back to you', 'discuss', 'check', 'see'
  ];

  // Default follow-up rules by stage
  private readonly followUpRules: FollowUpRule[] = [
    {
      stage: 'New',
      hoursAfterLastMessage: 24,
      messageTemplate: 'Hi {name}! Just following up on our conversation. Is there anything I can help you with?',
      maxFollowUps: 3
    },
    {
      stage: 'Contacted',
      hoursAfterLastMessage: 48,
      messageTemplate: 'Hello {name}! I wanted to check if you had a chance to think about our offer?',
      maxFollowUps: 2
    },
    {
      stage: 'Qualified',
      hoursAfterLastMessage: 24,
      messageTemplate: 'Hi {name}! Just checking in. Do you have any questions about moving forward?',
      maxFollowUps: 3
    },
    {
      stage: 'Proposal',
      hoursAfterLastMessage: 12,
      messageTemplate: 'Hi {name}! Have you had a chance to review the proposal I sent?',
      maxFollowUps: 4
    },
    {
      stage: 'Negotiation',
      hoursAfterLastMessage: 6,
      messageTemplate: 'Hello {name}! Let\'s finalize the details. When would be a good time to discuss?',
      maxFollowUps: 5
    }
  ];

  /**
   * Analyze message to detect deal status
   */
  async analyzeMessageForDealStatus(messageId: number): Promise<void> {
    try {
      // Get message and contact details
      const messageResult = await pool.query(
        `SELECT m.*, c.stage, c.business_id, c.id as contact_id, c.name as contact_name
         FROM messages m
         JOIN contacts c ON m.contact_id = c.id
         WHERE m.id = $1`,
        [messageId]
      );

      if (messageResult.rows.length === 0) return;

      const message = messageResult.rows[0];
      const content = message.content.toLowerCase();

      // Skip outbound messages
      if (message.direction === 'outbound') return;

      let newStage: string | null = null;
      let addTag: string | null = null;

      // Check for deal closed
      if (this.containsKeywords(content, this.dealClosedKeywords)) {
        newStage = 'Won';
        addTag = 'deal-closed';
        logger.info(`🎉 Deal detected as WON for contact ${message.contact_id}`);
      }
      // Check for deal lost
      else if (this.containsKeywords(content, this.dealLostKeywords)) {
        newStage = 'Lost';
        addTag = 'deal-lost';
        logger.info(`😞 Deal detected as LOST for contact ${message.contact_id}`);
      }
      // Check for needs follow-up
      else if (this.containsKeywords(content, this.needsFollowUpKeywords)) {
        addTag = 'needs-followup';
        logger.info(`📌 Contact ${message.contact_id} flagged for follow-up`);
      }

      // Update stage if detected
      if (newStage) {
        await this.updateContactStage(
          message.contact_id,
          message.business_id,
          message.stage,
          newStage
        );
      }

      // Add tag if needed
      if (addTag) {
        await this.addContactTag(message.contact_id, message.business_id, addTag);
      }

      // Schedule follow-up if needed
      if (newStage !== 'Won' && newStage !== 'Lost') {
        await this.scheduleFollowUp(message.contact_id, message.business_id);
      }

    } catch (error) {
      logger.error('Error analyzing message for deal status:', error);
    }
  }

  /**
   * Check if content contains any of the keywords
   */
  private containsKeywords(content: string, keywords: string[]): boolean {
    return keywords.some(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(content);
    });
  }

  /**
   * Update contact stage
   */
  private async updateContactStage(
    contactId: number,
    businessId: number,
    fromStage: string,
    toStage: string
  ): Promise<void> {
    // Update contact stage
    await pool.query(
      'UPDATE contacts SET stage = $1 WHERE id = $2',
      [toStage, contactId]
    );

    // Record in pipeline history
    await pool.query(
      `INSERT INTO pipeline_history (business_id, contact_id, from_stage, to_stage)
       VALUES ($1, $2, $3, $4)`,
      [businessId, contactId, fromStage, toStage]
    );

    logger.info(`📊 Updated contact ${contactId} from ${fromStage} to ${toStage}`);
  }

  /**
   * Add tag to contact
   */
  private async addContactTag(
    contactId: number,
    businessId: number,
    tag: string
  ): Promise<void> {
    // Check if tag already exists
    const existing = await pool.query(
      'SELECT id FROM contact_tags WHERE contact_id = $1 AND tag = $2',
      [contactId, tag]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO contact_tags (business_id, contact_id, tag) VALUES ($1, $2, $3)',
        [businessId, contactId, tag]
      );
      logger.info(`🏷️ Added tag "${tag}" to contact ${contactId}`);
    }
  }

  /**
   * Schedule follow-up for a contact
   */
  private async scheduleFollowUp(contactId: number, businessId: number): Promise<void> {
    // Get contact details
    const contactResult = await pool.query(
      'SELECT * FROM contacts WHERE id = $1',
      [contactId]
    );

    if (contactResult.rows.length === 0) return;

    const contact = contactResult.rows[0];
    
    // Find follow-up rule for contact's stage
    const rule = this.followUpRules.find(r => r.stage === contact.stage);
    
    if (!rule) return;

    // Calculate follow-up time
    const followUpTime = new Date();
    followUpTime.setHours(followUpTime.getHours() + rule.hoursAfterLastMessage);

    // Create automation rule for this specific follow-up
    await pool.query(
      `INSERT INTO automation_rules (business_id, trigger, condition, action, delay_minutes)
       VALUES ($1, 'scheduled_followup', $2, $3, $4)`,
      [
        businessId,
        JSON.stringify({ contact_id: contactId }),
        JSON.stringify({
          type: 'send_message',
          message: rule.messageTemplate.replace('{name}', contact.name || 'there')
        }),
        rule.hoursAfterLastMessage * 60
      ]
    );

    logger.info(`📅 Scheduled follow-up for contact ${contactId} in ${rule.hoursAfterLastMessage} hours`);
  }

  /**
   * Process pending follow-ups (runs periodically)
   */
  async processPendingFollowUps(): Promise<void> {
    try {
      logger.info('🔄 Processing pending follow-ups...');

      // Get all contacts that need follow-up
      const contactsNeedingFollowUp = await pool.query(`
        SELECT c.*, 
               MAX(m.sent_at) as last_message_time,
               COUNT(DISTINCT CASE WHEN ct.tag = 'followup-sent' THEN ct.id END) as followup_count
        FROM contacts c
        LEFT JOIN messages m ON c.id = m.contact_id
        LEFT JOIN contact_tags ct ON c.id = ct.contact_id
        WHERE c.stage NOT IN ('Won', 'Lost')
          AND c.last_active IS NOT NULL
        GROUP BY c.id
        HAVING MAX(m.sent_at) < NOW() - INTERVAL '24 hours'
      `);

      for (const contact of contactsNeedingFollowUp.rows) {
        const rule = this.followUpRules.find(r => r.stage === contact.stage);
        
        if (!rule) continue;
        
        // Check if we've exceeded max follow-ups
        if (contact.followup_count >= rule.maxFollowUps) {
          logger.info(`Skipping contact ${contact.id} - max follow-ups reached`);
          continue;
        }

        // Check if enough time has passed
        const hoursSinceLastMessage = 
          (Date.now() - new Date(contact.last_message_time).getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastMessage >= rule.hoursAfterLastMessage) {
          // Send follow-up message
          const message = rule.messageTemplate.replace('{name}', contact.name || 'there');
          
          await sendMessage(contact.business_id, contact.phone, message);
          
          // Add follow-up tag
          await this.addContactTag(contact.id, contact.business_id, 'followup-sent');
          
          logger.info(`✅ Sent follow-up to contact ${contact.id}`);
        }
      }

      logger.info('✅ Finished processing follow-ups');
    } catch (error) {
      logger.error('Error processing follow-ups:', error);
    }
  }

  /**
   * Identify contacts ready for conversion
   */
  async identifyHotLeads(businessId: number): Promise<any[]> {
    const result = await pool.query(`
      SELECT c.*,
             COUNT(DISTINCT m.id) as message_count,
             COUNT(DISTINCT CASE WHEN m.direction = 'inbound' THEN m.id END) as inbound_count,
             MAX(m.sent_at) as last_interaction
      FROM contacts c
      JOIN messages m ON c.id = m.contact_id
      WHERE c.business_id = $1
        AND c.stage IN ('Qualified', 'Proposal', 'Negotiation')
        AND m.sent_at >= NOW() - INTERVAL '7 days'
      GROUP BY c.id
      HAVING COUNT(DISTINCT CASE WHEN m.direction = 'inbound' THEN m.id END) >= 3
      ORDER BY last_interaction DESC
    `, [businessId]);

    return result.rows;
  }

  /**
   * Get follow-up statistics for a business
   */
  async getFollowUpStats(businessId: number): Promise<any> {
    const result = await pool.query(`
      SELECT 
        COUNT(DISTINCT c.id) as total_contacts,
        COUNT(DISTINCT CASE WHEN c.stage = 'Won' THEN c.id END) as deals_won,
        COUNT(DISTINCT CASE WHEN c.stage = 'Lost' THEN c.id END) as deals_lost,
        COUNT(DISTINCT CASE WHEN ct.tag = 'followup-sent' THEN c.id END) as followups_sent,
        COUNT(DISTINCT CASE WHEN ct.tag = 'needs-followup' THEN c.id END) as needs_followup
      FROM contacts c
      LEFT JOIN contact_tags ct ON c.id = ct.contact_id
      WHERE c.business_id = $1
    `, [businessId]);

    return result.rows[0];
  }

  /**
   * Start the follow-up scheduler (runs every hour)
   */
  startFollowUpScheduler(): void {
    // Run every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('⏰ Follow-up scheduler triggered');
      await this.processPendingFollowUps();
    });

    logger.info('📅 Follow-up scheduler started (runs every hour)');
  }

  /**
   * Create custom follow-up rule
   */
  async createCustomFollowUpRule(
    businessId: number,
    rule: {
      stage: string;
      hoursAfterLastMessage: number;
      messageTemplate: string;
      maxFollowUps: number;
    }
  ): Promise<void> {
    await pool.query(
      `INSERT INTO automation_rules (business_id, trigger, condition, action, delay_minutes)
       VALUES ($1, 'custom_followup', $2, $3, $4)`,
      [
        businessId,
        JSON.stringify({ stage: rule.stage }),
        JSON.stringify({
          type: 'send_message',
          message: rule.messageTemplate
        }),
        rule.hoursAfterLastMessage * 60
      ]
    );

    logger.info(`✅ Created custom follow-up rule for stage: ${rule.stage}`);
  }

  /**
   * Analyze conversation sentiment (basic keyword-based for now)
   */
  async analyzeConversationSentiment(contactId: number): Promise<'positive' | 'neutral' | 'negative'> {
    const messages = await pool.query(
      `SELECT content, direction FROM messages 
       WHERE contact_id = $1 
       AND direction = 'inbound'
       ORDER BY sent_at DESC LIMIT 10`,
      [contactId]
    );

    let positiveCount = 0;
    let negativeCount = 0;

    const positiveWords = ['yes', 'great', 'perfect', 'thanks', 'good', 'interested', 'excited'];
    const negativeWords = ['no', 'expensive', 'not', 'can\'t', 'won\'t', 'difficult', 'problem'];

    for (const msg of messages.rows) {
      const content = msg.content.toLowerCase();
      
      if (this.containsKeywords(content, positiveWords)) positiveCount++;
      if (this.containsKeywords(content, negativeWords)) negativeCount++;
    }

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }
}

export const followUpService = new FollowUpAutomationService();
export default followUpService;