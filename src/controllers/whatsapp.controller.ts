import { Request, Response, NextFunction } from 'express';
import { whatsappRepository } from '../repositories/whatsapp.repository';
import { AuthenticatedRequest, ForbiddenError } from '../types';
import * as R from '../utils/response';
import { z } from 'zod';

const CreateAccountSchema = z.object({
  phoneNumber: z.string().min(7).max(20),
  displayName: z.string().max(100).optional(),
  apiToken: z.string().min(10),
  provider: z.enum(['meta', 'twilio', 'vonage', 'wati']),
  dailyMessageLimit: z.number().int().positive().max(100000).optional(),
});

const UpdateAccountSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyMessageLimit: z.number().int().positive().max(100000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  apiToken: z.string().min(10).optional(),
});

export class WhatsAppController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const accounts = await whatsappRepository.list(user.tenantId);
      R.success(res, accounts);
    } catch (e) { next(e); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const account = await whatsappRepository.findById(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, account);
    } catch (e) { next(e); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can connect WhatsApp accounts');
      }
      const body = CreateAccountSchema.parse(req.body);
      const account = await whatsappRepository.create(user.tenantId, body);
      R.created(res, account, 'WhatsApp account connected');
    } catch (e) { next(e); }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can update WhatsApp accounts');
      }
      const body = UpdateAccountSchema.parse(req.body);
      const account = await whatsappRepository.update(user.tenantId, parseInt(req.params.id, 10), body);
      R.success(res, account, 'WhatsApp account updated');
    } catch (e) { next(e); }
  }

  async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      if (user.role !== 'owner') {
        throw new ForbiddenError('Only owners can disconnect WhatsApp accounts');
      }
      await whatsappRepository.disconnect(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, null, 'WhatsApp account disconnected');
    } catch (e) { next(e); }
  }
}

export const whatsappController = new WhatsAppController();
