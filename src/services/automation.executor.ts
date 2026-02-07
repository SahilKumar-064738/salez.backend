import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { sendMessage, sendTemplateMessage } from './whatsapp.service.js';

interface AutomationRule {
  id: number;
  business_id: number;
  trigger: string;
  condition: any;
  action: any;
  delay_minutes: number;
}

interface TriggerData {
  contact_id?: number;
  business_id: number;
  [key: string]: any;
}

/**
 * Automation Executor Service
 * Handles execution of automation rules when triggers are fired
 */
class AutomationExecutor {
  
  /**
   * Execute automation rules for a specific trigger
   */
  async executeTrigger(trigger: string, data: TriggerData): Promise<void> {
    try {
      logger.info(`🤖 Automation trigger fired: ${trigger}`, data);

      // Find matching automation rules
      const rules = await this.findMatchingRules(trigger, data.business_id);
      
      if (rules.length === 0) {
        logger.info(`No automation rules found for trigger: ${trigger}`);
        return;
      }

      logger.info(`Found ${rules.length} automation rule(s) for trigger: ${trigger}`);

      // Evaluate conditions and execute actions
      for (const rule of rules) {
        try {
          if (this.evaluateCondition(rule.condition, data)) {
            logger.info(`✅ Rule ${rule.id} condition matched`);
            
            if (rule.delay_minutes > 0) {
              await this.scheduleDelayedAction(rule, data);
            } else {
              await this.executeAction(rule, data);
            }
          } else {
            logger.info(`❌ Rule ${rule.id} condition not matched`);
          }
        } catch (error) {
          logger.error(`Error executing automation rule ${rule.id}:`, error);
          await this.logExecution(rule.id, data.contact_id, 'failed', data, (error as Error).message);
        }
      }
    } catch (error) {
      logger.error(`Error in automation trigger ${trigger}:`, error);
    }
  }

  /**
   * Find automation rules matching the trigger and business
   */
  private async findMatchingRules(trigger: string, businessId: number): Promise<AutomationRule[]> {
    const result = await pool.query(
      'SELECT * FROM automation_rules WHERE business_id = $1 AND trigger = $2',
      [businessId, trigger]
    );
    return result.rows;
  }

  /**
   * Evaluate if a condition matches the trigger data
   */
  private evaluateCondition(condition: any, data: TriggerData): boolean {
    try {
      // Handle empty or null conditions (always true)
      if (!condition || Object.keys(condition).length === 0) {
        return true;
      }

      // Evaluate each condition field
      for (const [key, expectedValue] of Object.entries(condition)) {
        const actualValue = data[key];

        // Handle different comparison types
        if (typeof expectedValue === 'object' && expectedValue !== null) {
          // Complex condition (e.g., {"operator": "equals", "value": "Won"})
          const operator = (expectedValue as any).operator;
          const value = (expectedValue as any).value;

          switch (operator) {
            case 'equals':
              if (actualValue !== value) return false;
              break;
            case 'not_equals':
              if (actualValue === value) return false;
              break;
            case 'contains':
              if (!String(actualValue).includes(String(value))) return false;
              break;
            case 'greater_than':
              if (Number(actualValue) <= Number(value)) return false;
              break;
            case 'less_than':
              if (Number(actualValue) >= Number(value)) return false;
              break;
            default:
              logger.warn(`Unknown operator: ${operator}`);
              return false;
          }
        } else {
          // Simple equality check
          if (actualValue !== expectedValue) return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error evaluating condition:', error);
      return false;
    }
  }

  /**
   * Execute an automation action
   */
  private async executeAction(rule: AutomationRule, data: TriggerData): Promise<void> {
    const action = rule.action;
    
    try {
      switch (action.type) {
        case 'send_message':
          await this.sendMessageAction(action, data, rule.business_id);
          break;
        
        case 'send_template':
          await this.sendTemplateAction(action, data, rule.business_id);
          break;
        
        case 'update_stage':
          await this.updateStageAction(action, data);
          break;
        
        case 'add_tag':
          await this.addTagAction(action, data, rule.business_id);
          break;
        
        default:
          logger.warn(`Unknown action type: ${action.type}`);
      }

      await this.logExecution(rule.id, data.contact_id, 'success', data);
      logger.info(`✅ Executed action for rule ${rule.id}`);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Schedule a delayed action (for future implementation with job queue)
   */
  private async scheduleDelayedAction(rule: AutomationRule, data: TriggerData): Promise<void> {
    // TODO: Implement with job queue (Bull/BullMQ)
    // For now, log that it would be scheduled
    logger.info(`📅 Would schedule rule ${rule.id} to execute in ${rule.delay_minutes} minutes`);
    
    // Temporary: Execute immediately for now
    logger.warn('Delayed actions not yet implemented, executing immediately');
    await this.executeAction(rule, data);
  }

  /**
   * Send a message action
   */
  private async sendMessageAction(action: any, data: TriggerData, businessId: number): Promise<void> {
    if (!data.contact_id) {
      throw new Error('Contact ID required for send_message action');
    }

    // Get contact phone number
    const contactResult = await pool.query(
      'SELECT phone FROM contacts WHERE id = $1 AND business_id = $2',
      [data.contact_id, businessId]
    );

    if (contactResult.rows.length === 0) {
      throw new Error('Contact not found');
    }

    const phone = contactResult.rows[0].phone;
    const message = action.message || action.content;

    await sendMessage(businessId, phone, message);
    logger.info(`📤 Sent message to contact ${data.contact_id}`);
  }

  /**
   * Send a template message action
   */
  private async sendTemplateAction(action: any, data: TriggerData, businessId: number): Promise<void> {
    if (!data.contact_id) {
      throw new Error('Contact ID required for send_template action');
    }

    const contactResult = await pool.query(
      'SELECT phone FROM contacts WHERE id = $1 AND business_id = $2',
      [data.contact_id, businessId]
    );

    if (contactResult.rows.length === 0) {
      throw new Error('Contact not found');
    }

    const phone = contactResult.rows[0].phone;
    const templateId = action.template_id;

    await sendTemplateMessage(businessId, phone, templateId);
    logger.info(`📤 Sent template message to contact ${data.contact_id}`);
  }

  /**
   * Update contact stage action
   */
  private async updateStageAction(action: any, data: TriggerData): Promise<void> {
    if (!data.contact_id) {
      throw new Error('Contact ID required for update_stage action');
    }

    const newStage = action.stage;
    await pool.query(
      'UPDATE contacts SET stage = $1 WHERE id = $2',
      [newStage, data.contact_id]
    );
    logger.info(`📊 Updated contact ${data.contact_id} stage to ${newStage}`);
  }

  /**
   * Add tag to contact action
   */
  private async addTagAction(action: any, data: TriggerData, businessId: number): Promise<void> {
    if (!data.contact_id) {
      throw new Error('Contact ID required for add_tag action');
    }

    const tag = action.tag;
    
    // Check if tag already exists
    const existingTag = await pool.query(
      'SELECT id FROM contact_tags WHERE contact_id = $1 AND tag = $2 AND business_id = $3',
      [data.contact_id, tag, businessId]
    );

    if (existingTag.rows.length === 0) {
      await pool.query(
        'INSERT INTO contact_tags (business_id, contact_id, tag) VALUES ($1, $2, $3)',
        [businessId, data.contact_id, tag]
      );
      logger.info(`🏷️ Added tag "${tag}" to contact ${data.contact_id}`);
    }
  }

  /**
   * Log automation execution
   */
  private async logExecution(
    ruleId: number,
    contactId: number | undefined,
    status: string,
    triggerData: any,
    errorMessage?: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO automation_logs (rule_id, contact_id, status, trigger_data, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [ruleId, contactId || null, status, JSON.stringify(triggerData), errorMessage || null]
    );
  }
}

// Export singleton instance
export const automationExecutor = new AutomationExecutor();

/**
 * Helper function to trigger automations
 */
export async function triggerAutomation(trigger: string, data: TriggerData): Promise<void> {
  await automationExecutor.executeTrigger(trigger, data);
}