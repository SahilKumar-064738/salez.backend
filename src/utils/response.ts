import { Response } from 'express';
import { PaginationMeta } from '../types';

/** Standard 200 success */
export function success<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
  meta?: Record<string, unknown>
): void {
  res.status(statusCode).json({
    success: true,
    data,
    ...(message && { message }),
    ...(meta && { meta }),
  });
}

/** 201 Created */
export function created<T>(res: Response, data: T, message?: string): void {
  res.status(201).json({
    success: true,
    data,
    ...(message && { message }),
  });
}

/** Cursor-paginated list */
export function cursor<T>(
  res: Response,
  data: T[],
  nextCursor: string | null,
  hasMore: boolean
): void {
  res.status(200).json({
    success: true,
    data,
    pagination: { nextCursor, hasMore },
  });
}

/** Offset-paginated list */
export function paginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta
): void {
  res.status(200).json({
    success: true,
    data,
    pagination: meta,
  });
}