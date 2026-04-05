/**
 * src/services/records.service.ts
 *
 * Business logic for the Records system.
 * Records represent client deadlines (GST, ITR, TDS, ROC, etc.)
 * with automatic WhatsApp reminder tracking.
 */

import { recordsRepository, RecordRow, CreateRecordInput } from '../repositories/records.repository';
import { AppError } from '../types';

export interface CreateRecordDto {
  client_name: string;
  phone: string;
  service_type: string;
  due_date: string;
  reminder_days_before?: number;
  data?: Record<string, unknown>;
}

export class RecordsService {
  /**
   * List all records for a tenant.
   */
  async list(tenantId: number): Promise<RecordRow[]> {
    return recordsRepository.list(tenantId);
  }

  /**
   * Get a single record by ID, scoped to tenant.
   */
  async getById(id: number, tenantId: number): Promise<RecordRow> {
    return recordsRepository.findById(id, tenantId);
  }

  /**
   * Create a new record.
   * Derives a `title` from client_name + service_type for easy searching.
   */
  async create(
    tenantId: number,
    userId: string,
    dto: CreateRecordDto,
  ): Promise<RecordRow> {
    if (!dto.client_name?.trim()) {
      throw new AppError('client_name is required', 400, 'VALIDATION_ERROR');
    }
    if (!dto.phone?.trim()) {
      throw new AppError('phone is required', 400, 'VALIDATION_ERROR');
    }
    if (!dto.due_date) {
      throw new AppError('due_date is required', 400, 'VALIDATION_ERROR');
    }

    const input: CreateRecordInput = {
      tenant_id: tenantId,
      title: `${dto.client_name.trim()} — ${dto.service_type ?? 'Other'}`,
      client_name: dto.client_name.trim(),
      phone: dto.phone.trim(),
      service_type: dto.service_type ?? 'Other',
      due_date: dto.due_date,
      reminder_days_before: dto.reminder_days_before ?? 3,
      data: dto.data ?? {},
      created_by: userId,
    };

    return recordsRepository.create(input);
  }

  /**
   * Delete a record (tenant-scoped).
   */
  async delete(id: number, tenantId: number): Promise<void> {
    // Verify ownership before deleting
    await recordsRepository.findById(id, tenantId);
    await recordsRepository.delete(id, tenantId);
  }
}

export const recordsService = new RecordsService();