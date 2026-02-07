import { Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        businessId: number;
        email: string;
        role: string;
      };
    }
  }
}

export {};
