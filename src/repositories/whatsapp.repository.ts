import { serviceRoleClient } from '../config/supabase';
import { WhatsAppAccount, NotFoundError, AppError } from '../types';
import { encrypt, decrypt } from '../utils/crypto';

export class WhatsAppRepository {
  /**
   * List all WhatsApp accounts for a tenant.
   * api_token_encrypted is NEVER returned.
   */
  async list(tenantId: number): Promise<Omit<WhatsAppAccount, 'api_token_encrypted'>[]> {
    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .select('id, tenant_id, phone_number, display_name, provider, status, connected_at, last_sent_at, daily_message_limit')
      .eq('tenant_id', tenantId)
      .order('connected_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as Omit<WhatsAppAccount, 'api_token_encrypted'>[];
  }

  async findById(
    tenantId: number,
    id: number
  ): Promise<Omit<WhatsAppAccount, 'api_token_encrypted'>> {
    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .select('id, tenant_id, phone_number, display_name, provider, status, connected_at, last_sent_at, daily_message_limit')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('WhatsApp account');
    return data as Omit<WhatsAppAccount, 'api_token_encrypted'>;
  }

  /**
   * Find by ID including the decrypted token — for internal use by message sending only.
   * Never expose this to API responses.
   */
  async findByIdWithToken(
    tenantId: number,
    id: number
  ): Promise<WhatsAppAccount & { api_token: string }> {
    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new NotFoundError('WhatsApp account');

    const account = data as WhatsAppAccount;
    if (account.status !== 'active') {
      throw new AppError(
        `WhatsApp account is ${account.status}`,
        409,
        'ACCOUNT_NOT_ACTIVE'
      );
    }

    return {
      ...account,
      api_token: decrypt(account.api_token_encrypted),
    };
  }

  async create(
    tenantId: number,
    params: {
      phoneNumber: string;
      displayName?: string;
      apiToken: string;
      provider: 'meta' | 'twilio' | 'vonage' | 'wati';
      dailyMessageLimit?: number;
    }
  ): Promise<Omit<WhatsAppAccount, 'api_token_encrypted'>> {
    const encryptedToken = encrypt(params.apiToken);

    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .insert({
        tenant_id: tenantId,
        phone_number: params.phoneNumber,
        display_name: params.displayName ?? null,
        api_token_encrypted: encryptedToken,
        provider: params.provider,
        status: 'active',
        daily_message_limit: params.dailyMessageLimit ?? 1000,
        connected_at: new Date().toISOString(),
      })
      .select('id, tenant_id, phone_number, display_name, provider, status, connected_at, last_sent_at, daily_message_limit')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new AppError('Phone number already connected for this tenant', 409, 'DUPLICATE_PHONE');
      }
      throw error;
    }

    return data as Omit<WhatsAppAccount, 'api_token_encrypted'>;
  }

  async update(
    tenantId: number,
    id: number,
    params: {
      displayName?: string;
      dailyMessageLimit?: number;
      status?: 'active' | 'inactive' | 'suspended' | 'disconnected';
      apiToken?: string;
    }
  ): Promise<Omit<WhatsAppAccount, 'api_token_encrypted'>> {
    const updates: Record<string, unknown> = {};
    if (params.displayName !== undefined) updates.display_name = params.displayName;
    if (params.dailyMessageLimit !== undefined) updates.daily_message_limit = params.dailyMessageLimit;
    if (params.status !== undefined) updates.status = params.status;
    if (params.apiToken !== undefined) updates.api_token_encrypted = encrypt(params.apiToken);

    const { data, error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, tenant_id, phone_number, display_name, provider, status, connected_at, last_sent_at, daily_message_limit')
      .single();

    if (error || !data) throw new NotFoundError('WhatsApp account');
    return data as Omit<WhatsAppAccount, 'api_token_encrypted'>;
  }

  async disconnect(tenantId: number, id: number): Promise<void> {
    const { error } = await serviceRoleClient
      .from('whatsapp_accounts')
      .update({ status: 'disconnected' })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  async touchLastSent(tenantId: number, id: number): Promise<void> {
    await serviceRoleClient
      .from('whatsapp_accounts')
      .update({ last_sent_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);
  }
}

export const whatsappRepository = new WhatsAppRepository();
