import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Database Migration Script
 * Creates all required tables for the WhatsApp CRM application
 */

async function migrate() {
  const client = await pool.connect();
  
  try {
    logger.info('🚀 Starting database migration...');
    
    await client.query('BEGIN');

    // Create businesses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        address TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created businesses table');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created users table');

    // Create contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        phone VARCHAR(50) NOT NULL,
        name VARCHAR(255),
        email VARCHAR(255),
        stage VARCHAR(50) DEFAULT 'New',
        notes TEXT,
        last_active TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(business_id, phone)
      )
    `);
    logger.info('✅ Created contacts table');

    // Create contact_tags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_tags (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        tag VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(contact_id, tag)
      )
    `);
    logger.info('✅ Created contact_tags table');

    // Create messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        content TEXT NOT NULL,
        message_type VARCHAR(50) DEFAULT 'text',
        status VARCHAR(50) DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMP,
        read_at TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created messages table');

    // Create templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        content TEXT NOT NULL,
        variables JSONB,
        language VARCHAR(10) DEFAULT 'en',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created templates table');

    // Create campaigns table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'draft',
        scheduled_at TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        target_count INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        delivered_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created campaigns table');

    // Create campaign_contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_contacts (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'pending',
        message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        sent_at TIMESTAMP,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(campaign_id, contact_id)
      )
    `);
    logger.info('✅ Created campaign_contacts table');

    // Create automation_rules table
    await client.query(`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(100) NOT NULL,
        trigger_config JSONB NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        action_config JSONB NOT NULL,
        conditions JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created automation_rules table');

    // Create automation_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id SERIAL PRIMARY KEY,
        rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL,
        trigger_data JSONB,
        error_message TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created automation_logs table');

    // Create analytics_events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB NOT NULL,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created analytics_events table');

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contacts_business_id ON contacts(business_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
      CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
      CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON messages(contact_id);
      CREATE INDEX IF NOT EXISTS idx_messages_business_id ON messages(business_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);
      CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns(business_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_automation_rules_business_id ON automation_rules(business_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_business_id ON analytics_events(business_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);
    `);
    logger.info('✅ Created indexes');

    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    logger.info('✅ Created trigger function');

    // Apply updated_at triggers to relevant tables
    const tablesWithUpdatedAt = [
      'businesses', 'users', 'contacts', 'templates', 'campaigns', 'automation_rules'
    ];

    for (const table of tablesWithUpdatedAt) {
      await client.query(`
        DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
        CREATE TRIGGER update_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `);
    }
    logger.info('✅ Created triggers for updated_at columns');

    await client.query('COMMIT');
    
    logger.info('🎉 Database migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
migrate()
  .then(() => {
    logger.info('✅ Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Migration script failed:', error);
    process.exit(1);
  });
