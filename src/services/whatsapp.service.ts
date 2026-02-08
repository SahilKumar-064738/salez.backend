import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { triggerAutomation } from './automation.executor.js';
import { followUpService } from './followup.service.js';

interface WhatsAppMessage {
  to: string;
  text?: string;
  template?: {
    name: string;
    parameters?: any[];
  };
}

interface WhatsAppResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * WhatsApp Service
 * Handles integration with WhatsApp Business API
 * Supports multiple providers: Meta WhatsApp Business API, Twilio, etc.
 */
class WhatsAppService {
  private apiUrl: string;
  private apiToken: string;
  private phoneNumberId?: string;

  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL || '';
    this.apiToken = process.env.WHATSAPP_API_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  /**
   * Get active WhatsApp account for a business
   */
  async getBusinessWhatsAppAccount(businessId: number): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM whatsapp_accounts 
       WHERE business_id = $1 AND status = 'active' 
       ORDER BY connected_at DESC 
       LIMIT 1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      throw new AppError('No active WhatsApp account found for this business', 404);
    }

    return result.rows[0];
  }

  /**
   * Send a text message via WhatsApp
   */
  async sendMessage(
    businessId: number,
    contactPhone: string,
    content: string,
    whatsappAccountId?: number
  ): Promise<WhatsAppResponse> {
    try {
      // Get WhatsApp account
      let account;
      if (whatsappAccountId) {
        const result = await pool.query(
          'SELECT * FROM whatsapp_accounts WHERE id = $1 AND business_id = $2',
          [whatsappAccountId, businessId]
        );
        if (result.rows.length === 0) {
          throw new AppError('WhatsApp account not found', 404);
        }
        account = result.rows[0];
      } else {
        account = await this.getBusinessWhatsAppAccount(businessId);
      }

      // Format phone number (remove + and ensure proper format)
      const formattedPhone = this.formatPhoneNumber(contactPhone);

      // Send message via WhatsApp API
      const response = await this.callWhatsAppAPI(account, {
        to: formattedPhone,
        text: content
      });

      return {
        success: true,
        messageId: response.messageId
      };
    } catch (error: any) {
      logger.error('WhatsApp send message error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send WhatsApp message'
      };
    }
  }

  /**
   * Send a template message via WhatsApp
   */
  async sendTemplateMessage(
    businessId: number,
    contactPhone: string,
    templateName: string,
    parameters: any[] = [],
    whatsappAccountId?: number
  ): Promise<WhatsAppResponse> {
    try {
      const account = whatsappAccountId
        ? await this.getWhatsAppAccountById(whatsappAccountId, businessId)
        : await this.getBusinessWhatsAppAccount(businessId);

      const formattedPhone = this.formatPhoneNumber(contactPhone);

      const response = await this.callWhatsAppAPI(account, {
        to: formattedPhone,
        template: {
          name: templateName,
          parameters
        }
      });

      return {
        success: true,
        messageId: response.messageId
      };
    } catch (error: any) {
      logger.error('WhatsApp template message error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send WhatsApp template message'
      };
    }
  }

  /**
   * Call WhatsApp API (Meta WhatsApp Business API format)
   * Modify this method to support different WhatsApp providers
   */
  private async callWhatsAppAPI(
    account: any,
    message: WhatsAppMessage
  ): Promise<{ messageId: string }> {
    const apiToken = account.api_token || this.apiToken;
    const phoneNumberId = account.phone_number_id || this.phoneNumberId;
    const apiUrl = this.apiUrl || `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

    if (!apiToken || !phoneNumberId) {
      throw new AppError('WhatsApp API credentials not configured', 500);
    }

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
    };

    if (message.text) {
      payload.type = 'text';
      payload.text = { body: message.text };
    } else if (message.template) {
      payload.type = 'template';
      payload.template = {
        name: message.template.name,
        language: { code: 'en' },
        components: message.template.parameters ? [
          {
            type: 'body',
            parameters: message.template.parameters.map((param: any) => ({
              type: 'text',
              text: String(param)
            }))
          }
        ] : []
      };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      throw new AppError(
        (errorData as any).error?.message || `WhatsApp API error: ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json() as any;
    return {
      messageId: (data as any).messages?.[0]?.id || (data as any).id || 'unknown'
    };
  }

  /**
   * Format phone number for WhatsApp API
   * WhatsApp requires phone numbers in international format without + sign
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // If phone starts with 0, replace with country code (default: 1 for US)
    // You may want to make this configurable per business
    if (cleaned.startsWith('0')) {
      cleaned = '1' + cleaned.substring(1);
    }
    
    return cleaned;
  }

  /**
   * Get WhatsApp account by ID
   */
  private async getWhatsAppAccountById(accountId: number, businessId: number): Promise<any> {
    const result = await pool.query(
      'SELECT * FROM whatsapp_accounts WHERE id = $1 AND business_id = $2',
      [accountId, businessId]
    );

    if (result.rows.length === 0) {
      throw new AppError('WhatsApp account not found', 404);
    }

    return result.rows[0];
  }

  /**
   * Process incoming webhook message
   */
  async processIncomingMessage(webhookData: any, businessId: number): Promise<void> {
    try {
      // Extract message data from webhook (Meta WhatsApp format)
      const entry = webhookData.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      if (!message || !contact) {
        logger.warn('Invalid webhook data structure');
        return;
      }

      const phoneNumber = contact.wa_id || contact.phone_number;
      const messageText = message.text?.body || '';
      const messageId = message.id;
      const timestamp = message.timestamp;

      // Find or create contact
      let contactResult = await pool.query(
        'SELECT id FROM contacts WHERE business_id = $1 AND phone = $2',
        [businessId, phoneNumber]
      );

      let contactId: number;
      if (contactResult.rows.length === 0) {
        // Create new contact
        const newContact = await pool.query(
          `INSERT INTO contacts (business_id, phone, name, last_active)
           VALUES ($1, $2, $3, NOW()) RETURNING id`,
          [businessId, phoneNumber, contact.profile?.name || null]
        );
        contactId = newContact.rows[0].id;
        
        // Trigger automation for new contact
        await triggerAutomation('contact_created', {
          contact_id: contactId,
          business_id: businessId,
          phone: phoneNumber,
          name: contact.profile?.name || null,
          stage: 'New'
        }).catch(error => {
          logger.error('Error triggering contact_created automation:', error);
        });
      } else {
        contactId = contactResult.rows[0].id;
        // Update last_active
        await pool.query(
          'UPDATE contacts SET last_active = NOW() WHERE id = $1',
          [contactId]
        );
      }

      // Get WhatsApp account ID
      const phoneNumberId = value.metadata?.phone_number_id;
      let whatsappAccountId = null;
      
      if (phoneNumberId) {
        const accountResult = await pool.query(
          `SELECT id FROM whatsapp_accounts 
           WHERE business_id = $1 AND phone_number_id = $2 
           LIMIT 1`,
          [businessId, phoneNumberId]
        );
        whatsappAccountId = accountResult.rows[0]?.id || null;
      }

      // Save message to database
      const messageResult = await pool.query(
        `INSERT INTO messages (business_id, whatsapp_account_id, contact_id, direction, content, status, sent_at)
         VALUES ($1, $2, $3, 'inbound', $4, 'delivered', to_timestamp($5))
         RETURNING id`,
        [businessId, whatsappAccountId, contactId, messageText, timestamp]
      );
      
      const newMessageId = messageResult.rows[0].id;

      // Trigger automation for message received
      await triggerAutomation('message_received', {
        message_id: newMessageId,
        contact_id: contactId,
        business_id: businessId,
        content: messageText,
        direction: 'inbound'
      }).catch(error => {
        logger.error('Error triggering message_received automation:', error);
      });

      // Analyze message for deal status and follow-up needs
      await followUpService.analyzeMessageForDealStatus(newMessageId).catch(error => {
        logger.error('Error analyzing message for deal status:', error);
      });

      logger.info(`Processed incoming WhatsApp message from ${phoneNumber}`);
    } catch (error) {
      logger.error('Error processing incoming WhatsApp message:', error);
      throw error;
    }
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;

// Export wrapper functions for easier access
export async function sendMessage(
  businessId: number,
  contactPhone: string,
  content: string,
  whatsappAccountId?: number
): Promise<number | null> {
  const result = await whatsappService.sendMessage(businessId, contactPhone, content, whatsappAccountId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to send message');
  }
  
  // Get contact ID to save message
  const contactResult = await pool.query(
    'SELECT id FROM contacts WHERE business_id = $1 AND phone = $2',
    [businessId, contactPhone]
  );
  
  const contactId = contactResult.rows[0]?.id;
  if (!contactId) {
    throw new Error('Contact not found');
  }
  
  // Save message to database
  const messageResult = await pool.query(
    `INSERT INTO messages (business_id, whatsapp_account_id, contact_id, direction, content, status)
     VALUES ($1, $2, $3, 'outbound', $4, 'sent')
     RETURNING id`,
    [businessId, whatsappAccountId || null, contactId, content]
  );
  
  return messageResult.rows[0].id;
}

export async function sendTemplateMessage(
  businessId: number,
  contactPhone: string,
  templateId: number | string,
  whatsappAccountId?: number
): Promise<number | null> {
  // If templateId is a number, get template name from database
  let templateName: string;
  
  if (typeof templateId === 'number') {
    const templateResult = await pool.query(
      'SELECT name FROM message_templates WHERE id = $1 AND business_id = $2',
      [templateId, businessId]
    );
    
    if (templateResult.rows.length === 0) {
      throw new Error('Template not found');
    }
    
    templateName = templateResult.rows[0].name;
  } else {
    templateName = templateId;
  }
  
  const result = await whatsappService.sendTemplateMessage(
    businessId,
    contactPhone,
    templateName,
    [],
    whatsappAccountId
  );
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to send template message');
  }
  
  // Get contact ID to save message
  const contactResult = await pool.query(
    'SELECT id FROM contacts WHERE business_id = $1 AND phone = $2',
    [businessId, contactPhone]
  );
  
  const contactId = contactResult.rows[0]?.id;
  if (!contactId) {
    throw new Error('Contact not found');
  }
  
  // Save message to database
  const messageResult = await pool.query(
    `INSERT INTO messages (business_id, whatsapp_account_id, contact_id, direction, content, status)
     VALUES ($1, $2, $3, 'outbound', $4, 'sent')
     RETURNING id`,
    [businessId, whatsappAccountId || null, contactId, `Template: ${templateName}`]
  );
  
  return messageResult.rows[0].id;
}

export async function processIncomingMessage(webhookData: any, businessId: number): Promise<void> {
  return whatsappService.processIncomingMessage(webhookData, businessId);
}