import { contactsRepository, ContactListFilters } from '../repositories/contacts.repository';
import { ContactWithTags, ContactStage, CursorPaginationResult } from '../types';

/**
 * Service layer for contacts.
 * Business logic lives here; repository handles raw DB access.
 */
export class ContactsService {
  async list(
    tenantId: number,
    filters: ContactListFilters
  ): Promise<CursorPaginationResult<ContactWithTags>> {
    return contactsRepository.list(tenantId, filters);
  }

  async findById(tenantId: number, id: number): Promise<ContactWithTags> {
    return contactsRepository.findById(tenantId, id);
  }

  async create(
    tenantId: number,
    params: {
      phone: string;
      name?: string;
      email?: string;
      stage?: ContactStage;
      notes?: string;
    }
  ): Promise<ContactWithTags> {
    return contactsRepository.create(tenantId, params);
  }

  async update(
    tenantId: number,
    id: number,
    params: {
      name?: string;
      email?: string | null;
      stage?: ContactStage;
      notes?: string | null;
    }
  ): Promise<ContactWithTags> {
    return contactsRepository.update(tenantId, id, params);
  }

  async delete(tenantId: number, id: number): Promise<void> {
    return contactsRepository.delete(tenantId, id);
  }

  async addTag(tenantId: number, contactId: number, tag: string): Promise<void> {
    return contactsRepository.addTag(tenantId, contactId, tag);
  }

  async removeTag(tenantId: number, contactId: number, tag: string): Promise<void> {
    return contactsRepository.removeTag(tenantId, contactId, tag);
  }

  async bulkCreate(
    tenantId: number,
    contacts: Array<{ phone: string; name?: string; email?: string; stage?: ContactStage; notes?: string }>
  ): Promise<ContactWithTags[]> {
    return contactsRepository.bulkCreate(tenantId, contacts);
  }

  async getPipelineStats(tenantId: number): Promise<Record<ContactStage, number>> {
    return contactsRepository.getPipelineStats(tenantId);
  }
}

export const contactsService = new ContactsService();