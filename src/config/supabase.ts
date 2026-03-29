import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * serviceRoleClient — bypasses RLS.
 * Use for all server-side DB operations.
 * NEVER expose this client to the frontend.
 */
export const serviceRoleClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  }
);

/**
 * anonClient — respects RLS.
 * Use for user auth operations only.
 */
export const anonClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);