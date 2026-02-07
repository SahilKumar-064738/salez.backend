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

    // Create ENUM types for better type safety
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE pipeline_stage AS ENUM ('New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'cancelled', 'trial');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    logger.info('✅ Created ENUM types');

    // Create businesses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        business_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created businesses table');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'owner',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created users table');

    // Create contacts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        name TEXT,
        stage TEXT DEFAULT 'New',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        last_active TIMESTAMP WITH TIME ZONE
      )
    `);
    logger.info('✅ Created contacts table');

    // Create contact_tags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_tags (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        tag TEXT NOT NULL
      )
    `);
    logger.info('✅ Created contact_tags table');

    // Create messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        whatsapp_account_id INTEGER,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        content TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created messages table');

    // Create message_templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info('✅ Created message_templates table');

    // Create campaigns table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        scheduled_at TIMESTAMP WITH TIME ZONE,
        status TEXT,
        target_count INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        delivered_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        trigger TEXT NOT NULL,
        condition JSONB NOT NULL,
        action JSONB NOT NULL,
        delay_minutes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Create campaign_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_logs (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        delivered BOOLEAN DEFAULT false,
        replied BOOLEAN DEFAULT false,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created campaign_logs table');

    // Create pipeline_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pipeline_history (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        from_stage TEXT,
        to_stage TEXT NOT NULL,
        changed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created pipeline_history table');

    // Create whatsapp_accounts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_accounts (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        phone_number TEXT NOT NULL UNIQUE,
        api_token TEXT,
        phone_number_id TEXT,
        status TEXT DEFAULT 'active',
        connected_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created whatsapp_accounts table');

    // Create plans table for subscription billing
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        conversation_limit INTEGER NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created plans table');

    // Create subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        renew_at TIMESTAMP WITH TIME ZONE,
        status subscription_status DEFAULT 'trial',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created subscriptions table');

    // Create usage_logs table for tracking API usage
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        conversation_id TEXT,
        cost NUMERIC(10, 2),
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    logger.info('✅ Created usage_logs table');

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
      CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_business_id ON analytics_events(business_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign_id ON campaign_logs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_logs_contact_id ON campaign_logs(contact_id);
      CREATE INDEX IF NOT EXISTS idx_pipeline_history_business_id ON pipeline_history(business_id);
      CREATE INDEX IF NOT EXISTS idx_pipeline_history_contact_id ON pipeline_history(contact_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_business_id ON whatsapp_accounts(business_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_phone_number ON whatsapp_accounts(phone_number);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_business_id ON subscriptions(business_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_business_id ON usage_logs(business_id);
      CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp);
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

    // Create automation trigger for new contacts
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_contact_created()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('contact_created', json_build_object(
          'contact_id', NEW.id,
          'business_id', NEW.business_id,
          'phone', NEW.phone,
          'name', NEW.name,
          'stage', NEW.stage
        )::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_contact_created ON contacts;
      CREATE TRIGGER trigger_contact_created
      AFTER INSERT ON contacts
      FOR EACH ROW
      EXECUTE FUNCTION notify_contact_created();
    `);
    logger.info('✅ Created contact creation trigger');

    // Create automation trigger for stage changes
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_stage_changed()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.stage IS DISTINCT FROM NEW.stage THEN
          PERFORM pg_notify('stage_changed', json_build_object(
            'contact_id', NEW.id,
            'business_id', NEW.business_id,
            'from_stage', OLD.stage,
            'to_stage', NEW.stage
          )::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_stage_changed ON contacts;
      CREATE TRIGGER trigger_stage_changed
      AFTER UPDATE ON contacts
      FOR EACH ROW
      EXECUTE FUNCTION notify_stage_changed();
    `);
    logger.info('✅ Created stage change trigger');

    // Create automation trigger for incoming messages
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_message_received()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.direction = 'inbound' THEN
          PERFORM pg_notify('message_received', json_build_object(
            'message_id', NEW.id,
            'business_id', NEW.business_id,
            'contact_id', NEW.contact_id,
            'content', NEW.content
          )::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_message_received ON messages;
      CREATE TRIGGER trigger_message_received
      AFTER INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION notify_message_received();
    `);
    logger.info('✅ Created message received trigger');

    // Note: Updated_at triggers removed as schema doesn't include updated_at columns

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