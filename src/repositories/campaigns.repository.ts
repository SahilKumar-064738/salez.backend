import { serviceRoleClient } from '../config/supabase';
import {
  Campaign,
  CampaignStatus,
  MessageTemplate,
  NotFoundError,
  ContactStage,
  CursorPaginationResult,
} from '../types';
import { encodeCursor, decodeCursor } from '../utils/pagination';

export interface CampaignListFilters {
  cursor?: string;
  limit: number;
  status?: CampaignStatus;
  search?: string;
}

export class CampaignsRepository {
  /**
   * FIXED: was returning ALL campaigns unbounded — now cursor-paginated.
   */
  async list(
    tenantId: number,
    filters: CampaignListFilters
  ): Promise<CursorPaginationResult<Campaign>> {
    const fetchLimit = filters.limit + 1;

    let query = serviceRoleClient
      .from('campaigns')
      .select('*, template:message_templates(id,name), whatsapp_account:whatsapp_accounts(id,phone_number,display_name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(fetchLimit);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.cursor) {
      const dec = decodeCursor(filters.cursor);
      if (dec) query = query.lt('created_at', dec.timestamp);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Campaign[];
    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.id, last.created_at) : null;

    return { data: items, nextCursor, hasMore };
  }

  async findById(tenantId: number, id: number): Promise<Campaign> {
    const { data, error } = await serviceRoleClient
      .from('campaigns')
      .select('*, template:message_templates(*), whatsapp_account:whatsapp_accounts(id,phone_number,display_name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('Campaign');
    return data as Campaign;
  }

  async create(
    tenantId: number,
    createdBy: string,
    params: {
      name: string;
      templateId: number;
      whatsappAccountId: number;
      scheduledAt?: string;
    }
  ): Promise<Campaign> {
    const { data, error } = await serviceRoleClient
      .from('campaigns')
      .insert({
        tenant_id: tenantId,
        name: params.name,
        template_id: params.templateId,
        whatsapp_account_id: params.whatsappAccountId,
        scheduled_at: params.scheduledAt ?? null,
        created_by: createdBy,
        status: params.scheduledAt ? 'scheduled' : 'draft',
      })
      .select()
      .single();

    if (error) throw error;
    return data as Campaign;
  }

  async updateStatus(
    tenantId: number,
    id: number,
    status: CampaignStatus,
    extra: {
      startedAt?: string;
      completedAt?: string;
      totalRecipients?: number;
    } = {}
  ): Promise<void> {
    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (extra.startedAt)         update.started_at = extra.startedAt;
    if (extra.completedAt)       update.completed_at = extra.completedAt;
    if (extra.totalRecipients !== undefined) update.total_recipients = extra.totalRecipients;

    const { error } = await serviceRoleClient
      .from('campaigns')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  async incrementSentCount(tenantId: number, campaignId: number, sent: number, failed: number): Promise<void> {
    const { data: current } = await serviceRoleClient
      .from('campaigns')
      .select('sent_count, failed_count')
      .eq('id', campaignId)
      .single();

    if (!current) return;

    await serviceRoleClient
      .from('campaigns')
      .update({
        sent_count: current.sent_count + sent,
        failed_count: current.failed_count + failed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);
  }

  async resolveContactsFromFilters(
    tenantId: number,
    filters: { stage?: ContactStage; tags?: string[] }
  ): Promise<number[]> {
    let query = serviceRoleClient
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (filters.stage) query = query.eq('stage', filters.stage);

    const { data, error } = await query;
    if (error) throw error;

    let ids = (data ?? []).map((r: { id: number }) => r.id);

    // FIXED: tag filter now done server-side via a separate query and intersect,
    // instead of doing N+1 per tag.
    if (filters.tags && filters.tags.length > 0) {
      const { data: taggedIds, error: tagErr } = await serviceRoleClient
        .from('contact_tags')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .in('tag', filters.tags);

      if (tagErr) throw tagErr;

      const tagSet = new Set((taggedIds ?? []).map((r: { contact_id: number }) => r.contact_id));
      ids = ids.filter((id) => tagSet.has(id));
    }

    return ids;
  }

  async insertRecipients(
    tenantId: number,
    campaignId: number,
    contactIds: number[]
  ): Promise<number> {
    // Batch in chunks of 500 to avoid Supabase request size limits
    const CHUNK_SIZE = 500;
    let totalInserted = 0;

    for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
      const chunk = contactIds.slice(i, i + CHUNK_SIZE);
      const rows = chunk.map((contactId) => ({
        campaign_id: campaignId,
        tenant_id: tenantId,
        contact_id: contactId,
        status: 'pending',
      }));

      const { data, error } = await serviceRoleClient
        .from('campaign_recipients')
        .insert(rows)
        .select('id');

      if (error) throw error;
      totalInserted += (data ?? []).length;
    }

    // Update total_recipients count on campaign
    await serviceRoleClient
      .from('campaigns')
      .update({ total_recipients: totalInserted, updated_at: new Date().toISOString() })
      .eq('id', campaignId);

    return totalInserted;
  }

  async getRecipients(
    tenantId: number,
    campaignId: number,
    opts: { limit: number; offset: number; status?: string }
  ) {
    let query = serviceRoleClient
      .from('campaign_recipients')
      .select('*, contact:contacts(id,name,phone)', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .eq('tenant_id', tenantId)
      .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.status) query = query.eq('status', opts.status);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── TEMPLATES ─────────────────────────────────────────────────────────────────

  async listTemplates(tenantId: number, status?: string): Promise<MessageTemplate[]> {
    let query = serviceRoleClient
      .from('message_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MessageTemplate[];
  }

  async findTemplateById(tenantId: number, id: number): Promise<MessageTemplate> {
    const { data, error } = await serviceRoleClient
      .from('message_templates')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('Template');
    return data as MessageTemplate;
  }

  async createTemplate(
    tenantId: number,
    createdBy: string,
    params: {
      name: string;
      content: string;
      variables: string[];
      category: 'marketing' | 'utility' | 'authentication';
    }
  ): Promise<MessageTemplate> {
    const { data, error } = await serviceRoleClient
      .from('message_templates')
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name: params.name,
        content: params.content,
        variables: params.variables,
        category: params.category,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;
    return data as MessageTemplate;
  }

  async updateTemplate(
    tenantId: number,
    id: number,
    params: Partial<{ name: string; content: string; variables: string[]; category: string; status: string }>
  ): Promise<MessageTemplate> {
    const { data, error } = await serviceRoleClient
      .from('message_templates')
      .update({ ...params, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !data) throw new NotFoundError('Template');
    return data as MessageTemplate;
  }

  async deleteTemplate(tenantId: number, id: number): Promise<void> {
    // Check no active campaigns reference this template
    const { count } = await serviceRoleClient
      .from('campaigns')
      .select('id', { count: 'exact' })
      .eq('template_id', id)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'scheduled', 'running']);

    if ((count ?? 0) > 0) {
      throw new Error('Cannot delete template referenced by active campaigns');
    }

    const { error } = await serviceRoleClient
      .from('message_templates')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }
}

export const campaignsRepository = new CampaignsRepository();
