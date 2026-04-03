import { Request, Response, NextFunction } from 'express';
import { contactsRepository } from '../repositories/contacts.repository';
import { AuthenticatedRequest, AppError } from '../types';
import * as R from '../utils/response';
import {
  CreateContactSchema,
  UpdateContactSchema,
  ContactsQuerySchema,
  TagSchema,
} from '../utils/validation';

export class ContactsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = ContactsQuerySchema.parse(req.query);
      const result = await contactsRepository.list(user.tenantId, {
        cursor: q.cursor, limit: q.limit, stage: q.stage, search: q.search, tag: q.tag,
      });
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (e) { next(e); }
  }

  async getPipelineStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const stats = await contactsRepository.getPipelineStats(user.tenantId);
      R.success(res, stats);
    } catch (e) { next(e); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid contact ID', 400, 'INVALID_PARAM');
      const contact = await contactsRepository.findById(user.tenantId, id);
      R.success(res, contact);
    } catch (e) { next(e); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateContactSchema.parse(req.body);
      const contact = await contactsRepository.create(user.tenantId, body);
      R.created(res, contact, 'Contact created');
    } catch (e) { next(e); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid contact ID', 400, 'INVALID_PARAM');
      const body = UpdateContactSchema.parse(req.body);
      const contact = await contactsRepository.update(user.tenantId, id, body);
      R.success(res, contact, 'Contact updated');
    } catch (e) { next(e); }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) throw new AppError('Invalid contact ID', 400, 'INVALID_PARAM');
      await contactsRepository.delete(user.tenantId, id);
      R.success(res, null, 'Contact deleted');
    } catch (e) { next(e); }
  }

  async addTag(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      const { tag } = TagSchema.parse(req.body);
      await contactsRepository.addTag(user.tenantId, id, tag);
      R.success(res, null, 'Tag added');
    } catch (e) { next(e); }
  }

  async removeTag(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      const tag = req.params.tag;
      if (!tag) throw new AppError('Tag is required', 400, 'INVALID_PARAM');
      await contactsRepository.removeTag(user.tenantId, id, tag);
      R.success(res, null, 'Tag removed');
    } catch (e) { next(e); }
  }
  async bulkCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      const { contacts } = req.body;

      if (!Array.isArray(contacts) || contacts.length === 0) {
        throw new AppError('contacts must be a non-empty array', 400, 'INVALID_INPUT');
      }

      // Optional: validate each contact (light validation)
      const payload = contacts.map((c: any) => {
        if (!c.phone) {
          throw new AppError('Each contact must have a phone', 400, 'INVALID_INPUT');
        }

        return {
          phone: c.phone,
          name: c.name || null,
          email: c.email || null,
        };
      });

      const result = await contactsRepository.bulkCreate(user.tenantId, payload);

      R.success(res, result, 'Contacts created successfully');

    } catch (e) {
      next(e);
    }
  }
}

export const contactsController = new ContactsController();