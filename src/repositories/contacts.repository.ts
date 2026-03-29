import { serviceRoleClient } from '../config/supabase';
import { Contact, ContactWithTags, ContactStage, NotFoundError, CursorPaginationResult } from '../types';
import { encodeCursor, decodeCursor } from '../utils/pagination';
import { logger } from '../utils/logger';

export interface ContactListFilters {
  cursor?: string;
  limit: number;
  stage?: ContactStage;
  search?: string;
  tag?: string;
}

export class ContactsRepository {
  /**
   * List contacts with cursor pagination.
   * Tenant-isolated. Soft-deleted contacts are excluded.
   * Supports search by name/phone and filter by stage or tag.
   */
  async list(
    tenantId: number,
    filters: ContactListFilters
  ): Promise<CursorPaginationResult<ContactWithTags>> {
    const fetchLimit = filters.limit + 1;

    // When tag filter is provided, find matching contact IDs first
    let tagContactIds: number[] | null = null;
    if (filters.tag) {
      const { data: tagRows, error: tagErr } = await serviceRoleClient
        .from('contact_tags')
        .select('contact_id')
        .eq('tenant_id', tenantId)
        .eq('tag', filters.tag);
      if (tagErr) throw tagErr;
      tagContactIds = (tagRows ?? []).map((r: { contact_id: number }) => r.contact_id);
      // If no contacts have this tag, return empty immediately
      if (tagContactIds.length === 0) {
        return { data: [], nextCursor: null, hasMore: false };
      }
    }

    let query = serviceRoleClient
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(fetchLimit);

    if (filters.stage)  query = query.eq('stage', filters.stage);
    if (filters.search) query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
    if (tagContactIds)  query = query.in('id', tagContactIds);
    if (filters.cursor) {
      const dec = decodeCursor(filters.cursor);
      if (dec) query = query.lt('created_at', dec.timestamp);
    }

    const { data, error } = await query;
    if (error) { logger.error({ error, tenantId }, 'contacts list failed'); throw error; }

    const rows = (data ?? []) as Contact[];
    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;

    // Batch-load tags for all returned contacts
    const contactIds = items.map((c) => c.id);
    let tagsMap: Record<number, string[]> = {};
    if (contactIds.length > 0) {
      const { data: tagRows } = await serviceRoleClient
        .from('contact_tags')
        .select('contact_id, tag')
        .eq('tenant_id', tenantId)
        .in('contact_id', contactIds);
      for (const row of tagRows ?? []) {
        const r = row as { contact_id: number; tag: string };
        if (!tagsMap[r.contact_id]) tagsMap[r.contact_id] = [];
        tagsMap[r.contact_id].push(r.tag);
      }
    }

    const withTags: ContactWithTags[] = items.map((c) => ({ ...c, tags: tagsMap[c.id] ?? [] }));
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.id, last.created_at) : null;
    return { data: withTags, nextCursor, hasMore };
  }

  async findById(tenantId: number, id: number): Promise<ContactWithTags> {
    const [contactRes, tagsRes] = await Promise.all([
      serviceRoleClient
        .from('contacts')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .single(),
      serviceRoleClient
        .from('contact_tags')
        .select('tag')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId),
    ]);

    if (contactRes.error || !contactRes.data) throw new NotFoundError('Contact');
    const tags = (tagsRes.data ?? []).map((r: { tag: string }) => r.tag);
    return { ...(contactRes.data as Contact), tags };
  }

  async create(tenantId: number, params: {
    phone: string; name?: string; email?: string;
    stage?: ContactStage; notes?: string;
  }): Promise<ContactWithTags> {
    const { data, error } = await serviceRoleClient
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        phone: params.phone,
        name: params.name ?? null,
        email: params.email ?? null,
        stage: params.stage ?? 'new',
        notes: params.notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return { ...(data as Contact), tags: [] };
  }

  async update(tenantId: number, id: number, params: {
    name?: string; email?: string | null;
    stage?: ContactStage; notes?: string | null;
  }): Promise<ContactWithTags> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (params.name  !== undefined) updates.name  = params.name;
    if (params.email !== undefined) updates.email = params.email;
    if (params.stage !== undefined) updates.stage = params.stage;
    if (params.notes !== undefined) updates.notes = params.notes;

    const { data, error } = await serviceRoleClient
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !data) throw new NotFoundError('Contact');

    const { data: tagRows } = await serviceRoleClient
      .from('contact_tags').select('tag').eq('contact_id', id).eq('tenant_id', tenantId);
    const tags = (tagRows ?? []).map((r: { tag: string }) => r.tag);
    return { ...(data as Contact), tags };
  }

  /** Soft-delete */
  async delete(tenantId: number, id: number): Promise<void> {
    const { error } = await serviceRoleClient
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async addTag(tenantId: number, contactId: number, tag: string): Promise<void> {
    const { error } = await serviceRoleClient
      .from('contact_tags')
      .insert({ tenant_id: tenantId, contact_id: contactId, tag });
    // Ignore duplicate (upsert-style)
    if (error && error.code !== '23505') throw error;
  }

  async removeTag(tenantId: number, contactId: number, tag: string): Promise<void> {
    const { error } = await serviceRoleClient
      .from('contact_tags')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('tag', tag);
    if (error) throw error;
  }

  /** Funnel counts per stage for the pipeline view */
  async getPipelineStats(tenantId: number): Promise<Record<ContactStage, number>> {
    const stages: ContactStage[] = ['new', 'contacted', 'qualified', 'converted', 'lost'];
    const results = await Promise.all(
      stages.map((stage) =>
        serviceRoleClient
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('stage', stage)
          .is('deleted_at', null)
      )
    );
    const stats = {} as Record<ContactStage, number>;
    stages.forEach((stage, i) => { stats[stage] = results[i].count ?? 0; });
    return stats;
  }
}

export const contactsRepository = new ContactsRepository();