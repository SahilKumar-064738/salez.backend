import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireSuperAdmin, auditLog } from '../middlewares/adminAuth.middleware';
import { adminController as C } from '../controllers/admin.controller';

export const adminRouter = Router();

// FIXED: all admin routes now require JWT + super-admin flag, NOT tenant-owner role.
// A super-admin is identified by auth.users.user_metadata.is_super_admin === true
// This prevents any tenant owner from accessing cross-tenant admin endpoints.
adminRouter.use(authMiddleware);
adminRouter.use(requireSuperAdmin);

// ── STATS ─────────────────────────────────────────────────────────────────────
adminRouter.get('/stats', C.getPlatformStats.bind(C));

// ── USERS ─────────────────────────────────────────────────────────────────────
adminRouter.get('/users',                          C.listUsers.bind(C));
adminRouter.get('/users/:id',                      C.getUserById.bind(C));
adminRouter.put('/users/:id/role',     auditLog('update_user_role'),    C.updateUserRole.bind(C));
adminRouter.post('/users/:id/deactivate', auditLog('deactivate_user'), C.deactivateUser.bind(C));
adminRouter.delete('/users/:id',       auditLog('delete_user'),         C.deleteUser.bind(C));

// ── TENANTS ───────────────────────────────────────────────────────────────────
adminRouter.get('/tenants',                        C.listTenants.bind(C));
adminRouter.get('/tenants/:id',                    C.getTenantById.bind(C));
adminRouter.patch('/tenants/:id',      auditLog('update_tenant'),        C.updateTenant.bind(C));
adminRouter.post('/tenants/:id/suspend',   auditLog('suspend_tenant'),   C.suspendTenant.bind(C));
adminRouter.post('/tenants/:id/activate',  auditLog('activate_tenant'),  C.activateTenant.bind(C));
adminRouter.delete('/tenants/:id',     auditLog('delete_tenant'),        C.deleteTenant.bind(C));
adminRouter.get('/tenants/:id/settings',           C.getTenantSettings.bind(C));
adminRouter.put('/tenants/:id/settings', auditLog('update_tenant_settings'), C.upsertTenantSettings.bind(C));

// ── CONTACTS ──────────────────────────────────────────────────────────────────
adminRouter.get('/contacts',                       C.listContacts.bind(C));
adminRouter.post('/contacts/import',   auditLog('import_contacts'),      C.importContacts.bind(C));
adminRouter.delete('/contacts/all',    auditLog('delete_all_contacts'),  C.deleteAllContacts.bind(C));
// NOTE: specific-id route MUST come AFTER /contacts/all to avoid param collision
adminRouter.delete('/contacts/:id/hard', auditLog('hard_delete_contact'), C.hardDeleteContact.bind(C));

// ── MESSAGES ─────────────────────────────────────────────────────────────────
adminRouter.get('/messages',                       C.listMessages.bind(C));
adminRouter.delete('/messages/:id',    auditLog('delete_message'),       C.deleteMessage.bind(C));

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
adminRouter.get('/campaigns',                      C.listCampaigns.bind(C));
adminRouter.delete('/campaigns/:id',   auditLog('delete_campaign'),      C.deleteCampaign.bind(C));
adminRouter.post('/campaigns/:id/force-send', auditLog('force_send_campaign'), C.forceSendCampaign.bind(C));
adminRouter.post('/campaigns/:id/retry',      auditLog('retry_campaign'),      C.retryCampaign.bind(C));

// ── CALLS ─────────────────────────────────────────────────────────────────────
adminRouter.get('/calls',                          C.listCalls.bind(C));

// ── API KEYS ──────────────────────────────────────────────────────────────────
adminRouter.get('/api-keys',                       C.listApiKeys.bind(C));
adminRouter.post('/api-keys',          auditLog('create_api_key'),       C.createApiKey.bind(C));
adminRouter.delete('/api-keys/:id',    auditLog('revoke_api_key'),       C.revokeApiKey.bind(C));

// ── LOGS ──────────────────────────────────────────────────────────────────────
adminRouter.get('/logs',               C.getAuditLogs.bind(C));        // FIXED: was querying wrong table
adminRouter.get('/api-logs',           C.getApiLogs.bind(C));          // FIXED: now queries api_logs
adminRouter.get('/login-attempts',     C.getLoginAttempts.bind(C));    // NEW endpoint

// ── DYNAMIC DB (fixed-name routes MUST come before :table wildcard) ────────────
adminRouter.get('/db/tables',                      C.listTables.bind(C));
adminRouter.delete('/db/reset',        auditLog('db_reset'),            C.resetDb.bind(C));
adminRouter.delete('/db/truncate/:table', auditLog('db_truncate'),      C.truncateTable.bind(C));
adminRouter.get('/db/:table',                      C.tableQuery.bind(C));
adminRouter.post('/db/:table',         auditLog('db_insert'),           C.tableInsert.bind(C));
adminRouter.put('/db/:table/:id',      auditLog('db_update'),           C.tableUpdate.bind(C));
adminRouter.delete('/db/:table/:id',   auditLog('db_delete_row'),       C.tableDelete.bind(C));
