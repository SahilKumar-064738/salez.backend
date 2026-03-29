-- =============================================================================
-- BACKEND HELPER FUNCTIONS
-- Run these in Supabase SQL Editor after the main schema.
-- =============================================================================

-- =========================================================
-- 1. decrypt_api_token
-- Called by the message worker to decrypt WhatsApp tokens.
-- The APP_ENCRYPTION_SECRET never leaves the DB server.
-- =========================================================
CREATE OR REPLACE FUNCTION decrypt_api_token(p_encrypted TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  -- Load the encryption secret from Supabase Vault
  -- In development you can use a fixed secret, in prod use vault.
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'APP_ENCRYPTION_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'APP_ENCRYPTION_SECRET not found in vault';
  END IF;

  RETURN pgp_sym_decrypt(p_encrypted::bytea, v_secret);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Token decryption failed: %', SQLERRM;
END;
$$;

-- =========================================================
-- 2. encrypt_api_token
-- Called when saving a new WhatsApp account token.
-- =========================================================
CREATE OR REPLACE FUNCTION encrypt_api_token(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'APP_ENCRYPTION_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'APP_ENCRYPTION_SECRET not found in vault';
  END IF;

  RETURN pgp_sym_encrypt(p_raw, v_secret)::TEXT;
END;
$$;

-- =========================================================
-- 3. increment_campaign_counts
-- Atomic counter increment — avoids race conditions from
-- concurrent worker updates.
-- =========================================================
CREATE OR REPLACE FUNCTION increment_campaign_counts(
  p_campaign_id BIGINT,
  p_sent        INT,
  p_failed      INT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE campaigns
  SET
    sent_count   = sent_count + p_sent,
    failed_count = failed_count + p_failed
  WHERE id = p_campaign_id;
$$;

-- =========================================================
-- 4. get_my_tenant_id (already in main schema — included
--    here for reference)
-- =========================================================
-- CREATE OR REPLACE FUNCTION get_my_tenant_id() ...
-- (See main schema — Section 6)

-- =========================================================
-- 5. Store encryption secret in Supabase Vault
-- Run once during deployment setup.
-- =========================================================
-- SELECT vault.create_secret(
--   'your-32-char-secret-here',
--   'APP_ENCRYPTION_SECRET',
--   'AES-256 key for WhatsApp token encryption'
-- );

-- =========================================================
-- 6. Auto-create message partition for current + next month
-- Schedule via pg_cron to run on the 25th of each month.
-- =========================================================
CREATE OR REPLACE FUNCTION create_next_message_partition()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
  month_after DATE := next_month + INTERVAL '1 month';
  partition_name TEXT := 'messages_' || to_char(next_month, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF messages FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    next_month,
    month_after
  );
END;
$$;

-- Schedule: SELECT cron.schedule('create-partitions', '0 0 25 * *', 'SELECT create_next_message_partition()');
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id   integer REFERENCES tenants(id) ON DELETE SET NULL,
  action      text NOT NULL,
  method      text,
  path        text,
  params      jsonb,
  body_keys   text[],
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON admin_audit_log (user_id);
CREATE INDEX ON admin_audit_log (created_at DESC);