import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter
 * Limits: 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * Auth routes rate limiter (stricter)
 * Limits: 5 login/register attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * WhatsApp webhook rate limiter
 * Limits: 1000 requests per minute (high throughput for webhooks)
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Allow high throughput for webhooks
  message: 'Webhook rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Campaign/bulk operations rate limiter
 * Limits: 10 requests per hour per IP
 */
export const bulkOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit bulk operations
  message: 'Too many bulk operations, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});