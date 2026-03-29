import { Request, Response, NextFunction } from 'express';
import { serviceRoleClient } from '../config/supabase';
import { hashApiKey } from '../utils/crypto';
import { ApiKeyRequest, UnauthorizedError } from '../types';
import { logger } from '../utils/logger';

/**
 * Authenticate requests via X-API-Key header.
 * The raw key is SHA-256 hashed and looked up in api_keys table.
 *
 * FIXED: scope wildcard '*' now grants access to all scopes.
 *
 * @param requiredScope - e.g. 'messages:write'. If omitted, only validates key existence + active status.
 */
export function apiKeyMiddleware(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      return next(new UnauthorizedError('Missing X-API-Key header'));
    }

    try {
      const hash = hashApiKey(rawKey);

      const { data: apiKey, error } = await serviceRoleClient
        .from('api_keys')
        .select('id, tenant_id, is_active, expires_at, scopes')
        .eq('key_hash', hash)
        .single();

      if (error || !apiKey) {
        return next(new UnauthorizedError('Invalid API key'));
      }

      if (!apiKey.is_active) {
        return next(new UnauthorizedError('API key has been revoked'));
      }

      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        return next(new UnauthorizedError('API key has expired'));
      }

      // FIXED: check for wildcard scope '*' before checking specific scope
      const scopes: string[] = apiKey.scopes ?? [];
      const hasWildcard = scopes.includes('*');

      if (requiredScope && !hasWildcard && !scopes.includes(requiredScope)) {
        return next(new UnauthorizedError(`API key missing required scope: ${requiredScope}`));
      }

      // Update last_used_at — fire-and-forget, never block the request
      serviceRoleClient
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', apiKey.id)
        .then(({ error }) => {
          if (error) logger.warn({ error, apiKeyId: apiKey.id }, 'Failed to update api_key last_used_at');
        });

      const keyReq = req as ApiKeyRequest;
      keyReq.tenantId = apiKey.tenant_id;
      keyReq.apiKeyId = apiKey.id;

      next();
    } catch (err) {
      logger.error({ err }, 'API key middleware error');
      next(new UnauthorizedError('API key authentication failed'));
    }
  };
}
