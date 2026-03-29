import { serviceRoleClient } from '../config/supabase';
import { NotFoundError, ForbiddenError } from '../types';
import { generateApiKey } from '../utils/crypto';

export interface ApiKey {
  id: number;
  tenant_id: number;
  created_by: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
}

export class ApiKeysRepository {
  /**
   * List all API keys for a tenant.
   * key_hash is NEVER selected.
   */
  async list(tenantId: number): Promise<ApiKey[]> {
    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .select('id, tenant_id, created_by, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at, revoked_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as ApiKey[];
  }

  async findById(tenantId: number, id: number): Promise<ApiKey> {
    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .select('id, tenant_id, created_by, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at, revoked_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('API key');
    return data as ApiKey;
  }

  /**
   * Create a new API key.
   * Returns the raw key ONCE — only the SHA-256 hash is stored.
   */
  async create(
    tenantId: number,
    createdBy: string,
    params: { name: string; scopes: string[]; expiresAt?: string }
  ): Promise<ApiKey & { raw_key: string }> {
    const { raw, hash, prefix } = generateApiKey();

    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name: params.name,
        key_prefix: prefix,
        key_hash: hash,
        scopes: params.scopes,
        is_active: true,
        expires_at: params.expiresAt ?? null,
      })
      .select('id, tenant_id, created_by, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at, revoked_at')
      .single();

    if (error) throw error;
    return { ...(data as ApiKey), raw_key: raw };
  }

  /**
   * Revoke (soft-delete) an API key.
   * Validates that the key belongs to the requesting tenant.
   */
  async revoke(tenantId: number, id: number): Promise<void> {
    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
      .single();

    if (error || !data) throw new NotFoundError('API key');
  }

  /**
   * Update scopes or expiry on an existing key.
   */
  async update(
    tenantId: number,
    id: number,
    params: { name?: string; scopes?: string[]; expiresAt?: string | null }
  ): Promise<ApiKey> {
    const updates: Record<string, unknown> = {};
    if (params.name !== undefined)    updates.name = params.name;
    if (params.scopes !== undefined)  updates.scopes = params.scopes;
    if (params.expiresAt !== undefined) updates.expires_at = params.expiresAt;

    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, tenant_id, created_by, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at, revoked_at')
      .single();

    if (error || !data) throw new NotFoundError('API key');
    return data as ApiKey;
  }
}

export const apiKeysRepository = new ApiKeysRepository();
