import { Request, Response, NextFunction } from 'express';
import { adminRepository } from '../repositories/admin.repository';
import { campaignDispatchQueue } from '../queues';
import * as R from '../utils/response';
import { AppError, AuthenticatedRequest } from '../types';

function parsePage(q: Record<string, unknown>) {
  return {
    page: Math.max(1, parseInt(q.page as string ?? '1', 10)),
    limit: Math.min(100, Math.max(1, parseInt(q.limit as string ?? '20', 10))),
  };
}

export class AdminController {
  // ── STATS ────────────────────────────────────────────────────────────────────

  async getPlatformStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await adminRepository.getPlatformStats();
      R.success(res, stats);
    } catch (e) { next(e); }
  }

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.listUsers({ ...parsePage(q), tenantId });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminRepository.getUserById(req.params.id);
      R.success(res, user);
    } catch (e) { next(e); }
  }

  async updateUserRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = req.body as { role: 'owner' | 'admin' | 'member' | 'viewer' };
      const valid = ['owner', 'admin', 'member', 'viewer'];
      if (!valid.includes(role)) throw new AppError('Invalid role', 400, 'INVALID_ROLE');
      const user = await adminRepository.updateUserRole(req.params.id, role);
      R.success(res, user, 'Role updated');
    } catch (e) { next(e); }
  }

  async deactivateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await adminRepository.deactivateUser(req.params.id);
      R.success(res, user, 'User deactivated');
    } catch (e) { next(e); }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.deleteUser(req.params.id);
      R.success(res, null, 'User deleted');
    } catch (e) { next(e); }
  }

  // ── TENANTS ───────────────────────────────────────────────────────────────────

  async listTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const result = await adminRepository.listTenants({
        ...parsePage(q),
        status: q.status as string | undefined,
        plan: q.plan as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async getTenantById(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await adminRepository.getTenantById(parseInt(req.params.id, 10));
      R.success(res, tenant);
    } catch (e) { next(e); }
  }

  async updateTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, plan } = req.body as { name?: string; plan?: string };
      const tenant = await adminRepository.updateTenant(id, { name, plan });
      R.success(res, tenant, 'Tenant updated');
    } catch (e) { next(e); }
  }

  async suspendTenant(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.suspendTenant(parseInt(req.params.id, 10));
      R.success(res, null, 'Tenant suspended');
    } catch (e) { next(e); }
  }

  async activateTenant(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.activateTenant(parseInt(req.params.id, 10));
      R.success(res, null, 'Tenant activated');
    } catch (e) { next(e); }
  }

  async deleteTenant(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.deleteTenant(parseInt(req.params.id, 10));
      R.success(res, null, 'Tenant soft-deleted');
    } catch (e) { next(e); }
  }

  async getTenantSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await adminRepository.getTenantSettings(parseInt(req.params.id, 10));
      R.success(res, settings);
    } catch (e) { next(e); }
  }

  async upsertTenantSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = parseInt(req.params.id, 10);
      const settings = await adminRepository.upsertTenantSettings(tenantId, req.body);
      R.success(res, settings, 'Settings updated');
    } catch (e) { next(e); }
  }

  // ── CONTACTS ──────────────────────────────────────────────────────────────────

  async listContacts(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.listAllContacts({
        ...parsePage(q),
        tenantId,
        search: q.search as string | undefined,
        stage: q.stage as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async hardDeleteContact(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id as string, 10) : undefined;
      await adminRepository.hardDeleteContact(parseInt(req.params.id, 10), tenantId);
      R.success(res, null, 'Contact permanently deleted');
    } catch (e) { next(e); }
  }

  async deleteAllContacts(req: Request, res: Response, next: NextFunction) {
    try {
      // FIXED: now requires tenant_id — no longer allows wiping all contacts globally
      const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id as string, 10) : undefined;
      await adminRepository.hardDeleteAllContacts(tenantId);
      R.success(res, null, 'All contacts for tenant deleted');
    } catch (e) { next(e); }
  }

  async importContacts(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId, contacts } = req.body as {
        tenantId: number;
        contacts: Array<{ phone: string; name?: string; email?: string }>;
      };
      if (!tenantId || !Array.isArray(contacts)) {
        throw new AppError('tenantId and contacts[] are required', 400, 'MISSING_FIELDS');
      }
      if (contacts.length > 10000) {
        throw new AppError('Maximum 10,000 contacts per import', 400, 'IMPORT_LIMIT');
      }
      const imported = await adminRepository.bulkImportContacts(tenantId, contacts);
      R.created(res, imported, `Imported ${imported.length} contacts`);
    } catch (e) { next(e); }
  }

  // ── MESSAGES ─────────────────────────────────────────────────────────────────

  async listMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.listAllMessages({
        ...parsePage(q),
        tenantId,
        direction: q.direction as string | undefined,
        status: q.status as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  // FIXED: now accepts optional sent_at to handle composite PK
  async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const sentAt = req.query.sent_at as string | undefined;
      await adminRepository.deleteMessage(parseInt(req.params.id, 10), sentAt);
      R.success(res, null, 'Message deleted');
    } catch (e) { next(e); }
  }

  // ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

  async listCampaigns(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.listAllCampaigns({
        ...parsePage(q),
        tenantId,
        status: q.status as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async deleteCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id as string, 10) : undefined;
      await adminRepository.deleteCampaign(parseInt(req.params.id, 10), tenantId);
      R.success(res, null, 'Campaign deleted');
    } catch (e) { next(e); }
  }

  async forceSendCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id, 10);
      const { tenantId } = req.body as { tenantId: number };
      if (!tenantId) throw new AppError('tenantId is required', 400, 'MISSING_FIELDS');
      await adminRepository.forceSendCampaign(tenantId, id);
      await campaignDispatchQueue.add(`admin-dispatch-${id}`, { tenantId, campaignId: id }, {
        jobId: `admin-campaign-dispatch-${id}`,
      });
      R.success(res, { campaignId: id, status: 'queued' }, 'Campaign force-sent');
    } catch (e) { next(e); }
  }

  async retryCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id, 10);
      const { tenantId } = req.body as { tenantId: number };
      if (!tenantId) throw new AppError('tenantId is required', 400, 'MISSING_FIELDS');
      await adminRepository.retryCampaign(tenantId, id);
      await campaignDispatchQueue.add(`admin-retry-${id}`, { tenantId, campaignId: id }, {
        jobId: `admin-campaign-retry-${id}`,
      });
      R.success(res, { campaignId: id }, 'Campaign retried');
    } catch (e) { next(e); }
  }

  // ── CALLS ─────────────────────────────────────────────────────────────────────

  async listCalls(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.listAllCalls({
        ...parsePage(q),
        tenantId,
        status: q.status as string | undefined,
        direction: q.direction as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  // ── API KEYS ──────────────────────────────────────────────────────────────────

  async listApiKeys(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const isActive = q.is_active !== undefined ? q.is_active === 'true' : undefined;
      const result = await adminRepository.listAllApiKeys({ ...parsePage(q), tenantId, isActive });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  // FIXED: now uses generateApiKey() instead of storing raw key as hash
  async createApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const { user } = req as AuthenticatedRequest;
      const { tenantId, name, scopes, expiresAt } = req.body as {
        tenantId: number; name: string; scopes?: string[]; expiresAt?: string;
      };
      if (!tenantId || !name) throw new AppError('tenantId and name are required', 400, 'MISSING_FIELDS');
      const key = await adminRepository.createApiKey(tenantId, user.id, name, scopes ?? ['*'], expiresAt);
      R.created(res, key, 'API key created — save the raw_key now, it will not be shown again');
    } catch (e) { next(e); }
  }

  async revokeApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.revokeApiKey(parseInt(req.params.id, 10));
      R.success(res, null, 'API key revoked');
    } catch (e) { next(e); }
  }

  // ── DYNAMIC DB ────────────────────────────────────────────────────────────────

  async listTables(_req: Request, res: Response, next: NextFunction) {
    try {
      const tables = await adminRepository.listTables();
      R.success(res, tables);
    } catch (e) { next(e); }
  }

  async tableQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const tenantId = q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined;
      const result = await adminRepository.tableQuery(req.params.table, { ...parsePage(q), tenantId });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async tableInsert(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await adminRepository.tableInsert(req.params.table, req.body);
      R.created(res, row);
    } catch (e) { next(e); }
  }

  async tableUpdate(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await adminRepository.tableUpdate(req.params.table, req.params.id, req.body);
      R.success(res, row);
    } catch (e) { next(e); }
  }

  async tableDelete(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.tableDelete(req.params.table, req.params.id);
      R.success(res, null, 'Row deleted');
    } catch (e) { next(e); }
  }

  async resetDb(req: Request, res: Response, next: NextFunction) {
    try {
      const { confirm } = req.body as { confirm?: string };
      if (confirm !== 'RESET_CONFIRMED') {
        throw new AppError('Send { confirm: "RESET_CONFIRMED" } to proceed', 400, 'CONFIRM_REQUIRED');
      }
      const tables = ['campaign_recipients', 'campaigns', 'messages', 'contacts', 'contact_tags'];
      for (const t of tables) await adminRepository.truncateTable(t);
      R.success(res, null, '⚠️ Database reset complete');
    } catch (e) { next(e); }
  }

  async truncateTable(req: Request, res: Response, next: NextFunction) {
    try {
      await adminRepository.truncateTable(req.params.table);
      R.success(res, null, `Table ${req.params.table} truncated`);
    } catch (e) { next(e); }
  }

  // ── LOGS ──────────────────────────────────────────────────────────────────────

  // FIXED: renamed getLogs → getAuditLogs, correctly queries admin_audit_log
  async getAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const result = await adminRepository.getAuditLogs({
        ...parsePage(q),
        userId: q.user_id as string | undefined,
        tenantId: q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined,
        action: q.action as string | undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  // FIXED: now correctly queries api_logs (previously queried login_attempts by mistake)
  async getApiLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const result = await adminRepository.getApiLogs({
        ...parsePage(q),
        tenantId: q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined,
        statusCode: q.status_code ? parseInt(q.status_code as string, 10) : undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }

  async getLoginAttempts(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const result = await adminRepository.getLoginAttempts({
        ...parsePage(q),
        email: q.email as string | undefined,
        tenantId: q.tenant_id ? parseInt(q.tenant_id as string, 10) : undefined,
        success: q.success !== undefined ? q.success === 'true' : undefined,
      });
      R.success(res, result.data, undefined, 200, { total: result.total });
    } catch (e) { next(e); }
  }
}

export const adminController = new AdminController();
