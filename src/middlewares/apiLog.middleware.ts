import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { AuthenticatedRequest, ApiKeyRequest } from '../types';
import { logger } from '../utils/logger';

/**
 * Middleware: asynchronously log every API request to the api_logs table.
 * Inserts into the PARENT api_logs table — PostgreSQL routes to the correct
 * quarterly partition (api_logs_2026_q1, etc.) automatically.
 *
 * Fire-and-forget: logging must NEVER block a request.
 */
export function apiLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startMs = Date.now();

  res.on('finish', () => {
    const responseTimeMs = Date.now() - startMs;

    // Extract tenant/key identity from whichever auth mechanism was used
    const authedReq = req as Partial<AuthenticatedRequest & ApiKeyRequest>;
    const tenantId  = authedReq.user?.tenantId ?? (authedReq as ApiKeyRequest).tenantId ?? null;
    const userId    = authedReq.user?.id ?? null;
    const apiKeyId  = (authedReq as ApiKeyRequest).apiKeyId ?? null;

    const requestSizeBytes  = parseInt(req.headers['content-length'] ?? '0', 10) || 0;
    const responseSizeBytes = parseInt(res.getHeader('content-length') as string ?? '0', 10) || 0;

    // Capture raw IP (trust proxy is set so this is real client IP)
    const ipAddress = req.ip ?? req.socket?.remoteAddress ?? null;

    // Non-blocking insert via fire-and-forget
    serviceRoleClient
      .from('api_logs')
      .insert({
        tenant_id:             tenantId,
        user_id:               userId,
        api_key_id:            apiKeyId,
        endpoint:              req.path,
        method:                req.method,
        status_code:           res.statusCode,
        response_time_ms:      responseTimeMs,
        request_size_bytes:    requestSizeBytes || null,
        response_size_bytes:   responseSizeBytes || null,
        ip_address:            ipAddress,
        error_message:         res.statusCode >= 400 ? (res.locals.errorMessage ?? null) : null,
        created_at:            new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) {
          logger.warn({ error, path: req.path }, 'Failed to write api_log (non-fatal)');
        }
      });
  });

  next();
}