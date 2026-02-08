import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import bcrypt from 'bcryptjs';

/**
 * Database Seeding Script
 * Populates database with initial data for development/testing
 */

async function seed() {
  const client = await pool.connect();
  
  try {
    logger.info('🌱 Starting database seeding...');
    
    await client.query('BEGIN');

    // Create sample business
    const businessResult = await client.query(`
      INSERT INTO businesses (business_name, email, status)
      VALUES ('Demo Business', 'demo@example.com', 'active')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);
    
    let businessId: number;
    if (businessResult.rows.length > 0) {
      businessId = businessResult.rows[0].id;
      logger.info('✅ Created demo business');
    } else {
      const existing = await client.query(
        "SELECT id FROM businesses WHERE email = 'demo@example.com'"
      );
      businessId = existing.rows[0].id;
      logger.info('ℹ️ Demo business already exists');
    }

    // Create sample user
    const hashedPassword = await bcrypt.hash('password123', 10);
    await client.query(`
      INSERT INTO users (business_id, name, email, password_hash, role)
      VALUES ($1, 'Demo User', 'demo@example.com', $2, 'owner')
      ON CONFLICT DO NOTHING
    `, [businessId, hashedPassword]);
    logger.info('✅ Created demo user (email: demo@example.com, password: password123)');

    // Create subscription plans
    const plans = [
      { name: 'Free', limit: 100, price: 0 },
      { name: 'Starter', limit: 1000, price: 29.99 },
      { name: 'Professional', limit: 5000, price: 99.99 },
      { name: 'Enterprise', limit: 20000, price: 299.99 }
    ];

    for (const plan of plans) {
      await client.query(`
        INSERT INTO plans (name, conversation_limit, price)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [plan.name, plan.limit, plan.price]);
    }
    logger.info('✅ Created subscription plans');

    // Get free plan ID
    const freePlanResult = await client.query(
      "SELECT id FROM plans WHERE name = 'Free' LIMIT 1"
    );
    const freePlanId = freePlanResult.rows[0].id;

    // Create trial subscription for demo business
    await client.query(`
      INSERT INTO subscriptions (business_id, plan_id, renews_at, status)
      VALUES ($1, $2, NOW() + INTERVAL '30 days', 'active')
      ON CONFLICT DO NOTHING
    `, [businessId, freePlanId]);
    logger.info('✅ Created trial subscription');

    // Create WhatsApp account
    await client.query(`
      INSERT INTO whatsapp_accounts (business_id, phone_number, status)
      VALUES ($1, '+1234567890', 'active')
      ON CONFLICT (phone_number) DO NOTHING
    `, [businessId]);
    logger.info('✅ Created WhatsApp account');

    // Create sample contacts
    const contacts = [
      { name: 'John Doe', phone: '+1234567891', stage: 'New' },
      { name: 'Jane Smith', phone: '+1234567892', stage: 'Contacted' },
      { name: 'Bob Johnson', phone: '+1234567893', stage: 'Qualified' },
      { name: 'Alice Williams', phone: '+1234567894', stage: 'Proposal' },
      { name: 'Charlie Brown', phone: '+1234567895', stage: 'Won' }
    ];

    for (const contact of contacts) {
      await client.query(`
        INSERT INTO contacts (business_id, phone, name, stage, created_at, last_active)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [businessId, contact.phone, contact.name, contact.stage]);
    }
    logger.info('✅ Created sample contacts');

    // Create sample message template
    const templateResult = await client.query(`
      INSERT INTO message_templates (business_id, name, content, status)
      VALUES ($1, 'Welcome Message', 'Hi {name}! Thanks for reaching out. How can we help you today?', 'approved')
      RETURNING id
    `, [businessId]);
    logger.info('✅ Created sample message template');

    // Create sample automation rule
    await client.query(`
      INSERT INTO automation_rules (business_id, trigger, condition, action, delay_minutes)
      VALUES (
        $1,
        'contact_created',
        '{}',
        '{"type": "send_message", "message": "Welcome! How can we help you today?"}',
        0
      )
    `, [businessId]);
    logger.info('✅ Created sample automation rule');

    // Create some sample messages
    const contactIds = await client.query(
      'SELECT id FROM contacts WHERE business_id = $1 LIMIT 3',
      [businessId]
    );

    for (const contact of contactIds.rows) {
      // Inbound message
      await client.query(`
        INSERT INTO messages (business_id, contact_id, direction, content, status, sent_at)
        VALUES ($1, $2, 'inbound', 'Hi, I am interested in your services', 'delivered', NOW() - INTERVAL '2 hours')
      `, [businessId, contact.id]);

      // Outbound message
      await client.query(`
        INSERT INTO messages (business_id, contact_id, direction, content, status, sent_at)
        VALUES ($1, $2, 'outbound', 'Great! I would love to help you. What are you looking for?', 'sent', NOW() - INTERVAL '1 hour')
      `, [businessId, contact.id]);
    }
    logger.info('✅ Created sample messages');

    // Create sample tags
    const sampleContactId = contactIds.rows[0].id;
    await client.query(`
      INSERT INTO contact_tags (business_id, contact_id, tag)
      VALUES 
        ($1, $2, 'vip'),
        ($1, $2, 'interested')
    `, [businessId, sampleContactId]);
    logger.info('✅ Created sample tags');

    await client.query('COMMIT');
    
    logger.info('🎉 Database seeding completed successfully!');
    logger.info('');
    logger.info('📝 Demo Account Credentials:');
    logger.info('   Email: demo@example.com');
    logger.info('   Password: password123');
    logger.info('');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run seeding
seed()
  .then(() => {
    logger.info('✅ Seeding script finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Seeding script failed:', error);
    process.exit(1);
  });