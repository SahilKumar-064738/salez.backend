import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { sendTemplateMessage } from './whatsapp.service.js';

interface Campaign {
  id: number;
  business_id: number;
  template_id: number;
  name: string;
  scheduled_at: Date | null;
  status: string;
  target_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
}

/**
 * Campaign Executor Service
 * Handles execution of scheduled campaigns and bulk message sending
 */
class CampaignExecutor {

  /**
   * Execute a campaign by sending messages to all contacts
   */
  async executeCampaign(campaignId: number): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get campaign details
      const campaignResult = await client.query(
        'SELECT * FROM campaigns WHERE id = $1',
        [campaignId]
      );

      if (campaignResult.rows.length === 0) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      const campaign: Campaign = campaignResult.rows[0];

      // Check if campaign is ready to execute
      if (campaign.status === 'completed' || campaign.status === 'running') {
        logger.warn(`Campaign ${campaignId} is already ${campaign.status}`);
        return;
      }

      logger.info(`🚀 Starting campaign execution: ${campaign.name} (ID: ${campaignId})`);

      // Update campaign status to running
      await client.query(
        'UPDATE campaigns SET status = $1 WHERE id = $2',
        ['running', campaignId]
      );

      // Get all pending campaign contacts
      const contactsResult = await client.query(
        `SELECT cc.id as campaign_contact_id, cc.contact_id, c.phone, c.name
         FROM campaign_contacts cc
         JOIN contacts c ON c.id = cc.contact_id
         WHERE cc.campaign_id = $1 AND cc.status = 'pending'`,
        [campaignId]
      );

      const contacts = contactsResult.rows;
      logger.info(`Found ${contacts.length} contacts to message`);

      let sentCount = 0;
      let failedCount = 0;

      // Send messages to each contact
      for (const contact of contacts) {
        try {
          await this.sendCampaignMessage(
            campaign,
            contact.contact_id,
            contact.phone,
            contact.campaign_contact_id,
            client
          );
          sentCount++;
          
          // Update campaign_contacts status
          await client.query(
            'UPDATE campaign_contacts SET status = $1, sent_at = NOW() WHERE id = $2',
            ['sent', contact.campaign_contact_id]
          );

          // Add small delay to avoid rate limiting (100ms between messages)
          await this.delay(100);
        } catch (error) {
          failedCount++;
          logger.error(`Failed to send message to contact ${contact.contact_id}:`, error);
          
          // Update campaign_contacts with error
          await client.query(
            'UPDATE campaign_contacts SET status = $1, error_message = $2 WHERE id = $3',
            ['failed', (error as Error).message, contact.campaign_contact_id]
          );
        }
      }

      // Update campaign with final counts
      await client.query(
        `UPDATE campaigns 
         SET status = $1, 
             sent_count = sent_count + $2, 
             failed_count = failed_count + $3
         WHERE id = $4`,
        ['completed', sentCount, failedCount, campaignId]
      );

      await client.query('COMMIT');

      logger.info(`✅ Campaign ${campaignId} completed: ${sentCount} sent, ${failedCount} failed`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Campaign ${campaignId} execution failed:`, error);
      
      // Update campaign status to failed
      await pool.query(
        'UPDATE campaigns SET status = $1 WHERE id = $2',
        ['failed', campaignId]
      );
      
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Send a campaign message to a single contact
   */
  private async sendCampaignMessage(
    campaign: Campaign,
    contactId: number,
    phone: string,
    campaignContactId: number,
    client: any
  ): Promise<void> {
    try {
      // Send the template message
      const messageId = await sendTemplateMessage(
        campaign.business_id,
        phone,
        campaign.template_id
      );

      // Create campaign log
      await client.query(
        `INSERT INTO campaign_logs (campaign_id, contact_id, delivered, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [campaign.id, contactId, true]
      );

      // Update contact's last_active
      await client.query(
        'UPDATE contacts SET last_active = NOW() WHERE id = $1',
        [contactId]
      );

      logger.debug(`📤 Sent campaign message to ${phone}`);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check and execute scheduled campaigns
   */
  async processScheduledCampaigns(): Promise<void> {
    try {
      // Find campaigns that are scheduled to run now or in the past
      const result = await pool.query(
        `SELECT id FROM campaigns 
         WHERE status = 'scheduled' 
         AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC`
      );

      if (result.rows.length === 0) {
        logger.debug('No scheduled campaigns to execute');
        return;
      }

      logger.info(`Found ${result.rows.length} scheduled campaign(s) to execute`);

      for (const row of result.rows) {
        try {
          await this.executeCampaign(row.id);
        } catch (error) {
          logger.error(`Error executing scheduled campaign ${row.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error processing scheduled campaigns:', error);
    }
  }

  /**
   * Add contacts to a campaign
   */
  async addContactsToCampaign(
    campaignId: number,
    contactIds: number[]
  ): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get campaign to verify it exists and get business_id
      const campaignResult = await client.query(
        'SELECT id, business_id FROM campaigns WHERE id = $1',
        [campaignId]
      );

      if (campaignResult.rows.length === 0) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      // Insert contacts into campaign_contacts
      for (const contactId of contactIds) {
        await client.query(
          `INSERT INTO campaign_contacts (campaign_id, contact_id, status)
           VALUES ($1, $2, 'pending')
           ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
          [campaignId, contactId]
        );
      }

      // Update target_count
      await client.query(
        `UPDATE campaigns 
         SET target_count = (
           SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = $1
         )
         WHERE id = $1`,
        [campaignId]
      );

      await client.query('COMMIT');
      logger.info(`Added ${contactIds.length} contacts to campaign ${campaignId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const campaignExecutor = new CampaignExecutor();

/**
 * Start background job to process scheduled campaigns
 * Call this from the main application startup
 */
export function startCampaignScheduler(intervalMinutes: number = 5): NodeJS.Timer {
  logger.info(`📅 Starting campaign scheduler (checking every ${intervalMinutes} minutes)`);
  
  // Run immediately on start
  campaignExecutor.processScheduledCampaigns();
  
  // Then run at intervals
  return setInterval(() => {
    campaignExecutor.processScheduledCampaigns();
  }, intervalMinutes * 60 * 1000);
}