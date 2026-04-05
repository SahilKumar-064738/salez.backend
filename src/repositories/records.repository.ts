/**
 * src/repositories/records.repository.ts
 *
 * Data-access layer for the `records` table.
 * All queries are scoped to tenant_id for multi-tenant isolation.
 */

import { serviceRoleClient } from '../config/supabase';
import { AppError } from '../types';

export interface RecordRow {
  id: number;
  tenant_id: number;
  title: string;
  client_name: string;
  phone: string;
  service_type: string;
  due_date: string;
  reminder_days_before: number;
  data: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRecordInput {
  tenant_id: number;
  title: string;
  client_name: string;
  phone: string;
  service_type: string;
  due_date: string;
  reminder_days_before: number;
  data?: Record<string, unknown>;
  created_by: string;
}

export class RecordsRepository {
  private readonly table = 'records';

  async list(tenantId: number): Promise<RecordRow[]> {
    const { data, error } = await serviceRoleClient
      .from(this.table)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as RecordRow[];
  }

  async findById(id: number, tenantId: number): Promise<RecordRow> {
    const { data, error } = await serviceRoleClient
      .from(this.table)
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) throw new AppError('Record not found', 404, 'NOT_FOUND');
    return data as RecordRow;
  }

  async create(input: CreateRecordInput): Promise<RecordRow> {
    const { data, error } = await serviceRoleClient
      .from(this.table)
      .insert({
        tenant_id: input.tenant_id,
        title: input.title,
        client_name: input.client_name,
        phone: input.phone,
        service_type: input.service_type,
        due_date: input.due_date,
        reminder_days_before: input.reminder_days_before,
        data: input.data ?? {},
        created_by: input.created_by,
      })
      .select()
      .single();

    if (error) throw error;
    return data as RecordRow;
  }

  async delete(id: number, tenantId: number): Promise<void> {
    const { error } = await serviceRoleClient
      .from(this.table)
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }
}

export const recordsRepository = new RecordsRepository();