import { Request, Response, NextFunction } from 'express';

/**
 * captureRawBody — attaches the raw Buffer body to req.rawBody.
 * Only needed for routes where signature verification requires the unmodified body.
 * Must be used AFTER express.raw() has already processed the request.
 *
 * For Meta/Twilio webhooks, express.raw() is applied at the server level
 * before this middleware runs, so req.body is already a Buffer.
 */
export function captureRawBody(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // express.raw() already gives us a Buffer in req.body — just ensure it's attached
  if (Buffer.isBuffer(req.body)) {
    (req as Request & { rawBody: Buffer }).rawBody = req.body;
  }
  next();
}