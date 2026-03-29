import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../types';
import { logger } from '../utils/logger';

/**
 * Centralized error handler.
 * Converts all error types into a consistent { success, error, code, statusCode } shape.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // ── Zod validation errors ──────────────────────────────────────────────────
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // ── Supabase / PostgREST errors ───────────────────────────────────────────
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const pgErr = err as { code: string; message: string; details?: string };

    // Unique constraint violation
    if (pgErr.code === '23505') {
      res.status(409).json({
        success: false,
        error: 'Resource already exists',
        code: 'DUPLICATE_ENTRY',
        statusCode: 409,
      });
      return;
    }

    // Foreign key constraint violation
    if (pgErr.code === '23503') {
      res.status(422).json({
        success: false,
        error: 'Referenced resource does not exist',
        code: 'INVALID_REFERENCE',
        statusCode: 422,
      });
      return;
    }

    // PostgREST no rows returned (single() with no match)
    if (pgErr.code === 'PGRST116') {
      res.status(404).json({
        success: false,
        error: 'Resource not found',
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
  }

  // ── AppError (our custom typed errors) ─────────────────────────────────────
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path, method: req.method }, 'AppError 5xx');
    }
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
    });
    return;
  }

  // ── Generic / unhandled errors ─────────────────────────────────────────────
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    // Only expose message in development
    ...(process.env.NODE_ENV === 'development' && { detail: message }),
  });
}

/**
 * 404 handler — must be placed AFTER all route definitions.
 */
export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
    statusCode: 404,
  });
}
