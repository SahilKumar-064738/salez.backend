import { serviceRoleClient } from '../config/supabase';
import { AppError } from '../types';
import { generateApiKey } from '../utils/crypto';

// Safe allowlist of tables accessible via the admin dynamic CRUD endpoints.
// Partitioned child tables are intentionally excluded — use the parent.
const ALLOWED_TABLES = new Set([
  'tenants', 'tenant_settings', 'user_profiles', 'contacts',
  'contact_tags', 'messages', 'campaigns', 'campaign_recipients',
  'message_templates', 'whatsapp_accounts', 'api_keys',
  'login_attempts', 'calls', 'call_metrics', 'call_recordings',
]);

// Tables whose PK is NOT a simple integer 'id' column — need special handling.
const COMPOSITE_PK_TABLES = new Set([
  'messages', 'calls', 'call_events', 'call_transcripts', 'api_logs',
  'contacts', 'contact_tags',
]);

// Tables that are NOT safe to truncate via the admin API (too dangerous).
const PROTECTED_TABLES = new Set(['tenants', 'user_profiles', 'api_keys']);

function assertTable(table: string): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new AppError(`Table "${table}" is not accessible via admin API`, 400, 'INVALID_TABLE');
  }
}

export class AdminRepository {
  // ── USERS ──────────────────────────────────────────────────────────────────

  async listUsers(filters: { page: number; limit: number; tenantId?: number }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('user_profiles')
      .select('id, tenant_id, role, display_name, avatar_url, is_active, created_at, updated_at, tenant:tenants(id,name,slug,plan)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async getUserById(id: string) {
    const { data, error } = await serviceRoleClient
      .from('user_profiles')
      .select('*, tenant:tenants(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new AppError('User not found', 404, 'NOT_FOUND');
    return data;
  }

  async updateUserRole(id: string, role: 'owner' | 'admin' | 'member' | 'viewer') {
    const { data, error } = await serviceRoleClient
      .from('user_profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new AppError('User not found', 404, 'NOT_FOUND');
    return data;
  }

  async deactivateUser(id: string) {
    const { data, error } = await serviceRoleClient
      .from('user_profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new AppError('User not found', 404, 'NOT_FOUND');
    return data;
  }

  async deleteUser(id: string) {
    // Deactivate profile first (soft), then delete from auth
    await serviceRoleClient
      .from('user_profiles')
      .update({ is_active: false })
      .eq('id', id);
    const { error } = await serviceRoleClient.auth.admin.deleteUser(id);
    if (error) throw new AppError(error.message, 500, 'DELETE_USER_FAILED');
  }

  // ── TENANTS ─────────────────────────────────────────────────────────────────

  async listTenants(filters: { page: number; limit: number; status?: string; plan?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('tenants')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.plan)   query = query.eq('plan', filters.plan);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async getTenantById(id: number) {
    const { data, error } = await serviceRoleClient
      .from('tenants').select('*').eq('id', id).single();
    if (error || !data) throw new AppError('Tenant not found', 404, 'NOT_FOUND');
    return data;
  }

  async updateTenant(id: number, updates: { name?: string; plan?: string }) {
    const { data, error } = await serviceRoleClient
      .from('tenants')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new AppError('Tenant not found', 404, 'NOT_FOUND');
    return data;
  }

  async suspendTenant(id: number) {
    const { error } = await serviceRoleClient
      .from('tenants').update({ status: 'suspended', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async activateTenant(id: number) {
    const { error } = await serviceRoleClient
      .from('tenants').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async deleteTenant(id: number) {
    // Soft-delete: status = 'deleted'
    const { error } = await serviceRoleClient
      .from('tenants').update({ status: 'deleted', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async getTenantSettings(tenantId: number) {
    const { data, error } = await serviceRoleClient
      .from('tenant_settings').select('*').eq('tenant_id', tenantId).single();
    if (error || !data) throw new AppError('Tenant settings not found', 404, 'NOT_FOUND');
    return data;
  }

  async upsertTenantSettings(tenantId: number, settings: Record<string, unknown>) {
    const { data, error } = await serviceRoleClient
      .from('tenant_settings')
      .upsert({ ...settings, tenant_id: tenantId, updated_at: new Date().toISOString() })
      .select().single();
    if (error) throw error;
    return data;
  }

  // ── CONTACTS ─────────────────────────────────────────────────────────────────

  async listAllContacts(filters: { page: number; limit: number; tenantId?: number; search?: string; stage?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('contacts')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.stage)    query = query.eq('stage', filters.stage);
    if (filters.search)   query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async hardDeleteContact(id: number, tenantId?: number) {
    let query = serviceRoleClient.from('contacts').delete().eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId) as typeof query;
    const { error } = await query;
    if (error) throw error;
  }

  async hardDeleteAllContacts(tenantId?: number) {
    if (!tenantId) {
      // Safety: require tenantId to nuke all contacts — full-DB wipe must go through resetDb
      throw new AppError('tenantId required to delete all contacts', 400, 'TENANT_REQUIRED');
    }
    const { error } = await serviceRoleClient
      .from('contacts')
      .delete()
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async bulkImportContacts(tenantId: number, contacts: Array<{ phone: string; name?: string; email?: string }>) {
    const rows = contacts.map((c) => ({ ...c, tenant_id: tenantId, stage: 'new' as const }));
    const { data, error } = await serviceRoleClient
      .from('contacts')
      .upsert(rows, { onConflict: 'tenant_id,phone', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    return data ?? [];
  }

  // ── MESSAGES ─────────────────────────────────────────────────────────────────

  async listAllMessages(filters: { page: number; limit: number; tenantId?: number; direction?: string; status?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('messages')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId)  query = query.eq('tenant_id', filters.tenantId);
    if (filters.direction) query = query.eq('direction', filters.direction);
    if (filters.status)    query = query.eq('status', filters.status);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  /**
   * FIX: admin deleting a message needs both id + sent_at due to composite PK.
   * We use the Supabase .delete().eq() approach matching on both columns.
   */
  async deleteMessage(id: number, sentAt?: string) {
    let query = serviceRoleClient.from('messages').delete().eq('id', id);
    if (sentAt) query = query.eq('sent_at', sentAt) as typeof query;
    const { error } = await query;
    if (error) throw error;
  }

  // ── CAMPAIGNS ────────────────────────────────────────────────────────────────

  async listAllCampaigns(filters: { page: number; limit: number; tenantId?: number; status?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('campaigns')
      .select('*, template:message_templates(id,name), whatsapp_account:whatsapp_accounts(id,phone_number,display_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.status)   query = query.eq('status', filters.status);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async deleteCampaign(id: number, tenantId?: number) {
    // Delete recipients first (FK constraint)
    await serviceRoleClient.from('campaign_recipients').delete().eq('campaign_id', id);
    let query = serviceRoleClient.from('campaigns').delete().eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId) as typeof query;
    const { error } = await query;
    if (error) throw error;
  }

  async forceSendCampaign(tenantId: number, campaignId: number) {
    const { error } = await serviceRoleClient
      .from('campaigns')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async retryCampaign(tenantId: number, campaignId: number) {
    // Reset failed recipients to pending
    await serviceRoleClient
      .from('campaign_recipients')
      .update({ status: 'pending', error_message: null })
      .eq('campaign_id', campaignId)
      .eq('status', 'failed');
    // Reset campaign
    const { error } = await serviceRoleClient
      .from('campaigns')
      .update({ status: 'draft', failed_count: 0, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  // ── API KEYS ─────────────────────────────────────────────────────────────────

  async listAllApiKeys(filters: { page: number; limit: number; tenantId?: number; isActive?: boolean }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    // NEVER select key_hash
    let query = serviceRoleClient
      .from('api_keys')
      .select('id, name, key_prefix, scopes, is_active, tenant_id, expires_at, last_used_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId !== undefined) query = query.eq('tenant_id', filters.tenantId);
    if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  /**
   * FIX: Previously stored raw key as key_hash — CRITICAL security bug.
   * Now uses generateApiKey() which returns a proper SHA-256 hash.
   */
  async createApiKey(tenantId: number, createdBy: string, name: string, scopes: string[], expiresAt?: string) {
    const { raw, hash, prefix } = generateApiKey();
    const { data, error } = await serviceRoleClient
      .from('api_keys')
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name,
        key_prefix: prefix,
        key_hash: hash,   // ← store the HASH, not the raw key
        scopes,
        is_active: true,
        expires_at: expiresAt ?? null,
      })
      .select('id, name, key_prefix, scopes, is_active, tenant_id, expires_at, created_at')
      .single();
    if (error) throw error;
    // raw_key shown ONCE — not stored
    return { ...data, raw_key: raw };
  }

  async revokeApiKey(id: number, tenantId?: number) {
    let query = serviceRoleClient
      .from('api_keys')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId) as typeof query;
    const { error } = await query;
    if (error) throw error;
  }

  // ── CALLS ─────────────────────────────────────────────────────────────────────

  async listAllCalls(filters: { page: number; limit: number; tenantId?: number; status?: string; direction?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('calls')
      .select('*', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId)  query = query.eq('tenant_id', filters.tenantId);
    if (filters.status)    query = query.eq('status', filters.status);
    if (filters.direction) query = query.eq('direction', filters.direction);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── DYNAMIC DB ────────────────────────────────────────────────────────────────

  async listTables() {
    return Array.from(ALLOWED_TABLES);
  }

  async tableQuery(table: string, filters: { page: number; limit: number; tenantId?: number }) {
    assertTable(table);
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from(table)
      .select('*', { count: 'exact' })
      .range(from, to);
    // Auto-scope to tenant if table has tenant_id
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId) as typeof query;
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async tableInsert(table: string, body: Record<string, unknown>) {
    assertTable(table);
    // Strip any attempt to override critical system fields
    const safeBody = { ...body };
    delete safeBody['created_at'];
    delete safeBody['updated_at'];
    const { data, error } = await serviceRoleClient
      .from(table)
      .insert(safeBody)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async tableUpdate(table: string, id: string, body: Record<string, unknown>) {
    assertTable(table);
    const safeBody = { ...body };
    delete safeBody['id'];
    delete safeBody['tenant_id'];  // never allow cross-tenant row hijack
    delete safeBody['created_at'];
    const { data, error } = await serviceRoleClient
      .from(table)
      .update(safeBody)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async tableDelete(table: string, id: string) {
    assertTable(table);
    const { error } = await serviceRoleClient.from(table).delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * FIX: Previously used .neq('id', 0) which fails for composite PK tables.
   * Now uses a safe per-table strategy.
   */
  async truncateTable(table: string) {
    assertTable(table);
    if (PROTECTED_TABLES.has(table)) {
      throw new AppError(`Table "${table}" is protected and cannot be truncated`, 403, 'PROTECTED_TABLE');
    }
    // For composite PK tables, we do a date-based sweep (keep nothing)
    // For simple integer PK tables, gt(0) covers everything
    if (COMPOSITE_PK_TABLES.has(table)) {
      const { error } = await serviceRoleClient
        .from(table)
        .delete()
        .gt('created_at', '1970-01-01');
      if (error) throw error;
    } else {
      const { error } = await serviceRoleClient.from(table).delete().gt('id', 0);
      if (error) throw error;
    }
  }

  // ── LOGS ──────────────────────────────────────────────────────────────────────

  async getAuditLogs(filters: { page: number; limit: number; userId?: string; tenantId?: number; action?: string }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('admin_audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.userId)   query = query.eq('user_id', filters.userId);
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.action)   query = query.eq('action', filters.action);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  /**
   * FIX: Previously queried login_attempts — this now correctly queries api_logs.
   */
  async getApiLogs(filters: { page: number; limit: number; tenantId?: number; statusCode?: number }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('api_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.tenantId)   query = query.eq('tenant_id', filters.tenantId);
    if (filters.statusCode) query = query.eq('status_code', filters.statusCode);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async getLoginAttempts(filters: { page: number; limit: number; email?: string; tenantId?: number; success?: boolean }) {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    let query = serviceRoleClient
      .from('login_attempts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (filters.email)    query = query.eq('email', filters.email);
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.success !== undefined) query = query.eq('success', filters.success);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── STATS ─────────────────────────────────────────────────────────────────────

  async getPlatformStats() {
    const [tenants, users, contacts, messages, campaigns] = await Promise.all([
      serviceRoleClient.from('tenants').select('status', { count: 'exact' }).eq('status', 'active'),
      serviceRoleClient.from('user_profiles').select('id', { count: 'exact' }).eq('is_active', true),
      serviceRoleClient.from('contacts').select('id', { count: 'exact' }).is('deleted_at', null),
      serviceRoleClient.from('messages').select('id', { count: 'exact' }),
      serviceRoleClient.from('campaigns').select('id', { count: 'exact' }),
    ]);
    return {
      activeTenants: tenants.count ?? 0,
      activeUsers: users.count ?? 0,
      totalContacts: contacts.count ?? 0,
      totalMessages: messages.count ?? 0,
      totalCampaigns: campaigns.count ?? 0,
    };
  }
}

export const adminRepository = new AdminRepository();
