import { serviceRoleClient } from '../config/supabase';
import { Message, InboxSummary, NotFoundError, CursorPaginationResult } from '../types';
import { encodeCursor, decodeCursor } from '../utils/pagination';
import { logger } from '../utils/logger';

export class MessagesRepository {
  /**
   * Create an outbound message record with status 'pending'.
   * The actual send is handled by the queue worker.
   */
  async createOutbound(params: {
    tenantId: number;
    contactId: number;
    whatsappAccountId: number;
    content: string;
    mediaUrl?: string;
    mediaType?: string;
    campaignId?: number;
  }): Promise<Message> {
    const { data, error } = await serviceRoleClient
      .from('messages')
      .insert({
        tenant_id:            params.tenantId,
        contact_id:           params.contactId,
        whatsapp_account_id:  params.whatsappAccountId,
        campaign_id:          params.campaignId ?? null,
        direction:            'outbound',
        content:              params.content,
        media_url:            params.mediaUrl ?? null,
        media_type:           params.mediaType ?? null,
        status:               'pending',
        is_read:              true,   // outbound messages are always "read" by the sender
        sent_at:              new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data as Message;
  }

  /**
   * Create an inbound message (from webhook).
   */
  async createInbound(params: {
    tenantId: number;
    contactId: number;
    whatsappAccountId: number;
    content: string;
    mediaUrl?: string;
    mediaType?: string;
    externalMessageId?: string;
  }): Promise<Message> {
    const { data, error } = await serviceRoleClient
      .from('messages')
      .insert({
        tenant_id:            params.tenantId,
        contact_id:           params.contactId,
        whatsapp_account_id:  params.whatsappAccountId,
        direction:            'inbound',
        content:              params.content,
        media_url:            params.mediaUrl ?? null,
        media_type:           params.mediaType ?? null,
        status:               'delivered',
        external_message_id:  params.externalMessageId ?? null,
        is_read:              false,
        sent_at:              new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Update last_active on the contact (fire-and-forget)
    serviceRoleClient
      .from('contacts')
      .update({ last_active: new Date().toISOString() })
      .eq('id', params.contactId)
      .eq('tenant_id', params.tenantId)
      .then(({ error: e }) => {
        if (e) logger.warn({ e }, 'Failed to update contact last_active');
      });

    return data as Message;
  }

  /**
   * Update a message status (e.g. pending → sent → delivered → read).
   */
  async updateStatus(
    id: number,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    extra: { deliveredAt?: string; readAt?: string; externalMessageId?: string } = {}
  ): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (extra.deliveredAt)       updates.delivered_at = extra.deliveredAt;
    if (extra.readAt)            updates.read_at = extra.readAt;
    if (extra.externalMessageId) updates.external_message_id = extra.externalMessageId;

    const { error } = await serviceRoleClient
      .from('messages')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Inbox — one row per contact, showing the latest message.
   * Returns contacts with messages, ordered by most recent activity.
   */
  async getInbox(
    tenantId: number,
    opts: { cursor?: string; limit: number; unreadOnly?: boolean }
  ): Promise<CursorPaginationResult<InboxSummary>> {
    const fetchLimit = opts.limit + 1;

    // Get distinct contacts with their last message via subquery logic
    // Supabase doesn't support window functions directly — use a view or this approach
    let query = serviceRoleClient
      .from('messages')
      .select(`
        tenant_id,
        contact_id,
        content,
        direction,
        status,
        is_read,
        sent_at,
        contact:contacts!inner(id, name, phone, stage)
      `)
      .eq('tenant_id', tenantId)
      .order('sent_at', { ascending: false })
      .limit(fetchLimit * 10); // fetch extra to de-dup by contact

    if (opts.unreadOnly) query = query.eq('is_read', false).eq('direction', 'inbound');
    if (opts.cursor) {
      const dec = decodeCursor(opts.cursor);
      if (dec) query = query.lt('sent_at', dec.timestamp);
    }

    const { data, error } = await query;
    if (error) throw error;

    // De-duplicate — keep only the most recent message per contact
    const seen = new Set<number>();
    const deduplicated: InboxSummary[] = [];

    for (const row of data ?? []) {
      const r = row as {
        tenant_id: number;
        contact_id: number;
        content: string;
        direction: string;
        status: string;
        is_read: boolean;
        sent_at: string;
        contact: { id: number; name: string | null; phone: string; stage: string }[] | null;
      };
      if (seen.has(r.contact_id)) continue;
      seen.add(r.contact_id);

      // Count unread for this contact
      const { count: unreadCount } = await serviceRoleClient
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('contact_id', r.contact_id)
        .eq('direction', 'inbound')
        .eq('is_read', false);
      const contact = r.contact?.[0] ?? null;
      deduplicated.push({
        tenant_id:       r.tenant_id,
        contact_id:      r.contact_id,
        contact_name:    contact?.name ?? null,
        contact_phone:   contact?.phone ?? null,
        contact_stage:   contact?.stage as InboxSummary['contact_stage'],
        last_message:    r.content,
        last_direction:  r.direction as InboxSummary['last_direction'],
        last_status:     r.status as InboxSummary['last_status'],
        is_read:         r.is_read,
        last_message_at: r.sent_at,
        unread_count:    unreadCount ?? 0,
      });

      if (deduplicated.length >= fetchLimit) break;
    }

    const hasMore = deduplicated.length > opts.limit;
    const items = hasMore ? deduplicated.slice(0, opts.limit) : deduplicated;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.contact_id, last.last_message_at) : null;
    return { data: items, nextCursor, hasMore };
  }

  /**
   * Get all messages in a conversation (ordered oldest → newest).
   */
  async getConversation(
    tenantId: number,
    contactId: number,
    opts: { cursor?: string; limit: number }
  ): Promise<CursorPaginationResult<Message>> {
    const fetchLimit = opts.limit + 1;

    let query = serviceRoleClient
      .from('messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('sent_at', { ascending: false })
      .limit(fetchLimit);

    if (opts.cursor) {
      const dec = decodeCursor(opts.cursor);
      if (dec) query = query.lt('sent_at', dec.timestamp);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Message[];
    const hasMore = rows.length > opts.limit;
    const items = (hasMore ? rows.slice(0, opts.limit) : rows).reverse(); // chronological
    const oldest = items[0];
    const nextCursor = hasMore && oldest ? encodeCursor(oldest.id, oldest.sent_at) : null;
    return { data: items, nextCursor, hasMore };
  }

  /**
   * Mark all inbound messages in a conversation as read.
   */
  async markConversationRead(tenantId: number, contactId: number): Promise<void> {
    const { error } = await serviceRoleClient
      .from('messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('direction', 'inbound')
      .eq('is_read', false);

    if (error) throw error;
  }

  /**
   * Validate that a WhatsApp account belongs to a tenant (used in send flow).
   */
  async getWhatsAppAccount(tenantId: number, accountId: number): Promise<{ id: number }> {
    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .select('id')
      .eq('id', accountId)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .single();

    if (error || !data) throw new NotFoundError('WhatsApp account');
    return data as { id: number };
  }
}

export const messagesRepository = new MessagesRepository();