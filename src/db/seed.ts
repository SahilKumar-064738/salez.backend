import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import bcrypt from 'bcryptjs';

/**
 * Database Seed Script
 * Populates the database with sample data for development/testing
 */

async function seed() {
  const client = await pool.connect();
  
  try {
    logger.info('🌱 Starting database seeding...');
    
    await client.query('BEGIN');

    // Create sample business
    const businessResult = await client.query(`
      INSERT INTO businesses (business_name, email, phone, status)
      VALUES 
        ('Demo Company', 'demo@example.com', '+1234567890', 'active'),
        ('Test Business', 'test@example.com', '+0987654321', 'active')
      ON CONFLICT (email) DO NOTHING
      RETURNING id, business_name
    `);
    
    if (businessResult.rows.length > 0) {
      logger.info(`✅ Created ${businessResult.rows.length} businesses`);
      
      const business1Id = businessResult.rows[0].id;
      const business2Id = businessResult.rows[1]?.id || business1Id;

      // Create sample users
      const hashedPassword = await bcrypt.hash('password123', 10);
      
      const userResult = await client.query(`
        INSERT INTO users (business_id, name, email, password_hash, role)
        VALUES 
          ($1, 'Demo Owner', 'demo@example.com', $2, 'owner'),
          ($1, 'Demo User', 'user@demo.com', $2, 'user'),
          ($3, 'Test Owner', 'test@example.com', $2, 'owner')
        ON CONFLICT (email) DO NOTHING
        RETURNING id, name
      `, [business1Id, hashedPassword, business2Id]);
      
      if (userResult.rows.length > 0) {
        logger.info(`✅ Created ${userResult.rows.length} users`);
      }

      // Create sample contacts
      const contactResult = await client.query(`
        INSERT INTO contacts (business_id, phone, name, stage, notes, last_active)
        VALUES 
          ($1, '+1234567001', 'John Doe', 'New', 'Interested in product demo', NOW() - INTERVAL '1 hour'),
          ($1, '+1234567002', 'Jane Smith', 'Qualified', 'Ready to purchase', NOW() - INTERVAL '2 hours'),
          ($1, '+1234567003', 'Bob Johnson', 'Contacted', 'Follow up next week', NOW() - INTERVAL '1 day'),
          ($1, '+1234567004', 'Alice Brown', 'Converted', 'Happy customer', NOW() - INTERVAL '3 days'),
          ($1, '+1234567005', 'Charlie Wilson', 'New', 'Requested information', NOW() - INTERVAL '5 hours'),
          ($1, '+1234567006', 'Diana Martinez', 'Qualified', 'Budget approved', NOW() - INTERVAL '12 hours'),
          ($1, '+1234567007', 'Edward Davis', 'Lost', 'Went with competitor', NOW() - INTERVAL '7 days'),
          ($1, '+1234567008', 'Fiona Garcia', 'New', 'First contact', NOW() - INTERVAL '30 minutes')
        ON CONFLICT (business_id, phone) DO NOTHING
        RETURNING id
      `, [business1Id]);
      
      if (contactResult.rows.length > 0) {
        logger.info(`✅ Created ${contactResult.rows.length} contacts`);
        
        const contactIds = contactResult.rows.map(row => row.id);

        // Create sample messages
        const messageValues = [];
        const messageParams = [];
        let paramIndex = 1;

        contactIds.forEach((contactId, index) => {
          // Outbound message
          messageValues.push(`($${paramIndex}, $${paramIndex + 1}, 'outbound', 'Hello! How can I help you today?', 'text', 'delivered', NOW() - INTERVAL '${index + 1} hours')`);
          messageParams.push(business1Id, contactId);
          paramIndex += 2;

          // Inbound message
          if (index < 5) {
            messageValues.push(`($${paramIndex}, $${paramIndex + 1}, 'inbound', 'I am interested in your services', 'text', 'read', NOW() - INTERVAL '${index} hours')`);
            messageParams.push(business1Id, contactId);
            paramIndex += 2;
          }
        });

        if (messageValues.length > 0) {
          await client.query(`
            INSERT INTO messages (business_id, contact_id, direction, content, message_type, status, sent_at)
            VALUES ${messageValues.join(', ')}
          `, messageParams);
          logger.info(`✅ Created ${messageValues.length} messages`);
        }

        // Create sample tags
        await client.query(`
          INSERT INTO contact_tags (business_id, contact_id, tag)
          VALUES 
            ($1, $2, 'VIP'),
            ($1, $2, 'Hot Lead'),
            ($1, $3, 'Follow-up'),
            ($1, $4, 'Satisfied'),
            ($1, $5, 'New Inquiry')
          ON CONFLICT (contact_id, tag) DO NOTHING
        `, [business1Id, contactIds[0], contactIds[1], contactIds[3], contactIds[4]]);
        logger.info('✅ Created contact tags');
      }

      // Create sample templates
      const templateResult = await client.query(`
        INSERT INTO templates (business_id, name, category, content, variables, status)
        VALUES 
          ($1, 'Welcome Message', 'greeting', 'Hello {{name}}! Welcome to {{company}}. How can we help you today?', '["name", "company"]'::jsonb, 'active'),
          ($1, 'Follow Up', 'follow_up', 'Hi {{name}}, following up on our previous conversation. Are you still interested?', '["name"]'::jsonb, 'active'),
          ($1, 'Thank You', 'gratitude', 'Thank you {{name}} for your business! We appreciate you.', '["name"]'::jsonb, 'active'),
          ($1, 'Appointment Reminder', 'reminder', 'Hi {{name}}, this is a reminder for your appointment on {{date}} at {{time}}.', '["name", "date", "time"]'::jsonb, 'active')
        RETURNING id
      `, [business1Id]);
      logger.info(`✅ Created ${templateResult.rows.length} templates`);

      const templateId = templateResult.rows[0].id;

      // Create sample campaign
      const campaignResult = await client.query(`
        INSERT INTO campaigns (business_id, name, description, template_id, status, target_count, sent_count, delivered_count)
        VALUES 
          ($1, 'Welcome Campaign', 'Send welcome messages to new contacts', $2, 'active', 100, 75, 70),
          ($1, 'Summer Promotion', 'Promote summer deals', $2, 'completed', 50, 50, 48)
        RETURNING id
      `, [business1Id, templateId]);
      logger.info(`✅ Created ${campaignResult.rows.length} campaigns`);

      // Create sample automation rule
      await client.query(`
        INSERT INTO automation_rules (business_id, name, description, trigger_type, trigger_config, action_type, action_config, is_active)
        VALUES 
          ($1, 'Auto Welcome', 'Send welcome message to new contacts', 'contact_created', '{}'::jsonb, 'send_message', '{"template_id": $2}'::jsonb, true),
          ($1, 'Follow Up Reminder', 'Send follow up after 3 days', 'time_delay', '{"delay_hours": 72}'::jsonb, 'send_message', '{"template_id": $2}'::jsonb, true)
      `, [business1Id, templateId]);
      logger.info('✅ Created automation rules');

      // Create sample analytics events
      await client.query(`
        INSERT INTO analytics_events (business_id, event_type, event_data)
        VALUES 
          ($1, 'message_sent', '{"count": 150, "date": "2024-01-01"}'::jsonb),
          ($1, 'message_delivered', '{"count": 145, "date": "2024-01-01"}'::jsonb),
          ($1, 'message_read', '{"count": 120, "date": "2024-01-01"}'::jsonb),
          ($1, 'contact_created', '{"count": 25, "date": "2024-01-01"}'::jsonb),
          ($1, 'campaign_completed', '{"campaign_id": 1, "date": "2024-01-01"}'::jsonb)
      `, [business1Id]);
      logger.info('✅ Created analytics events');

    } else {
      logger.info('ℹ️  Businesses already exist, skipping seed');
    }

    await client.query('COMMIT');
    
    logger.info('🎉 Database seeding completed successfully!');
    logger.info('📝 Default credentials:');
    logger.info('   Email: demo@example.com');
    logger.info('   Password: password123');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run seed
seed()
  .then(() => {
    logger.info('✅ Seed script finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Seed script failed:', error);
    process.exit(1);
  });
