import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit by IP, falling back to forwarded header
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.ip
      ?? 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Too many requests — please slow down',
      code: 'RATE_LIMITED',
      statusCode: 429,
    });
  },
  skip: (req: Request) => req.path === '/health',
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: 'Too many auth attempts — try again later',
      code: 'AUTH_RATE_LIMITED',
      statusCode: 429,
    });
  },
});