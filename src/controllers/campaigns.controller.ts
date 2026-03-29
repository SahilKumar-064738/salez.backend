import { Request, Response, NextFunction } from 'express';
import { campaignsRepository } from '../repositories/campaigns.repository';
import { campaignDispatchQueue } from '../queues';
import { AuthenticatedRequest, AppError, ForbiddenError } from '../types';
import * as R from '../utils/response';
import {
  CreateCampaignSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  validate,
} from '../utils/validation';
import { z } from 'zod';

const CampaignListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(['draft', 'scheduled', 'running', 'completed', 'failed', 'cancelled']).optional(),
  search: z.string().max(100).optional(),
});

const RecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed', 'opted_out']).optional(),
});

export class CampaignsController {
  // ── TEMPLATES ─────────────────────────────────────────────────────────────────

  async listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const status = req.query.status as string | undefined;
      const templates = await campaignsRepository.listTemplates(user.tenantId, status);
      R.success(res, templates);
    } catch (err) { next(err); }
  }

  async getTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const template = await campaignsRepository.findTemplateById(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, template);
    } catch (err) { next(err); }
  }

  async createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = CreateTemplateSchema.parse(req.body);
      const template = await campaignsRepository.createTemplate(user.tenantId, user.id, body);
      R.created(res, template, 'Template created');
    } catch (err) { next(err); }
  }

  async updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const body = UpdateTemplateSchema.parse(req.body);
      const template = await campaignsRepository.updateTemplate(user.tenantId, parseInt(req.params.id, 10), body);
      R.success(res, template, 'Template updated');
    } catch (err) { next(err); }
  }

  async deleteTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      await campaignsRepository.deleteTemplate(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, null, 'Template deleted');
    } catch (err) { next(err); }
  }

  // ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

  /**
   * FIXED: now paginated, with status/search filters.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const q = CampaignListSchema.parse(req.query);
      const result = await campaignsRepository.list(user.tenantId, q);
      R.cursor(res, result.data, result.nextCursor, result.hasMore);
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const campaign = await campaignsRepository.findById(user.tenantId, parseInt(req.params.id, 10));
      R.success(res, campaign);
    } catch (err) { next(err); }
  }

  /**
   * GET /campaigns/:id/recipients
   * Paginated list of recipients with their delivery status.
   */
  async getRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;
      const id = parseInt(req.params.id, 10);
      const q = RecipientsQuerySchema.parse(req.query);
      const offset = (q.page - 1) * q.limit;
      const result = await campaignsRepository.getRecipients(user.tenantId, id, {
        limit: q.limit,
        offset,
        status: q.status,
      });
      R.paginated(res, result.data, {
        total: result.total,
        page: q.page,
        limit: q.limit,
        totalPages: Math.ceil(result.total / q.limit),
      });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can create campaigns');
      }

      const { name, templateId, whatsappAccountId, scheduledAt, contactIds, filters } =
        CreateCampaignSchema.parse(req.body);

      const campaign = await campaignsRepository.create(user.tenantId, user.id, {
        name, templateId, whatsappAccountId, scheduledAt,
      });

      let recipientIds: number[] = contactIds ?? [];

      if (recipientIds.length === 0 && filters) {
        recipientIds = await campaignsRepository.resolveContactsFromFilters(
          user.tenantId,
          filters as { stage?: import('../types').ContactStage; tags?: string[] }
        );
      }

      if (recipientIds.length === 0) {
        R.created(res, { ...campaign, recipientCount: 0 }, 'Campaign created (no recipients matched)');
        return;
      }

      const count = await campaignsRepository.insertRecipients(user.tenantId, campaign.id, recipientIds);
      R.created(res, { ...campaign, recipientCount: count }, 'Campaign created');
    } catch (err) { next(err); }
  }

  async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can send campaigns');
      }

      const id = parseInt(req.params.id, 10);
      const campaign = await campaignsRepository.findById(user.tenantId, id);

      if (!['draft', 'scheduled'].includes(campaign.status)) {
        throw new AppError(
          `Cannot send campaign with status "${campaign.status}"`,
          409, 'INVALID_CAMPAIGN_STATE'
        );
      }

      if (campaign.total_recipients === 0) {
        throw new AppError('Campaign has no recipients', 400, 'NO_RECIPIENTS');
      }

      await campaignDispatchQueue.add(
        `dispatch-${id}`,
        { tenantId: user.tenantId, campaignId: id },
        { jobId: `campaign-dispatch-${id}` }
      );

      R.success(res, { campaignId: id, status: 'queued' }, 'Campaign queued for sending');
    } catch (err) { next(err); }
  }

  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user } = req as AuthenticatedRequest;

      if (!['owner', 'admin'].includes(user.role)) {
        throw new ForbiddenError('Only owners and admins can cancel campaigns');
      }

      const id = parseInt(req.params.id, 10);
      const campaign = await campaignsRepository.findById(user.tenantId, id);

      if (!['draft', 'scheduled', 'running'].includes(campaign.status)) {
        throw new AppError('Cannot cancel a completed or failed campaign', 409, 'INVALID_STATE');
      }

      await campaignsRepository.updateStatus(user.tenantId, id, 'cancelled');
      R.success(res, null, 'Campaign cancelled');
    } catch (err) { next(err); }
  }
}

export const campaignsController = new CampaignsController();
