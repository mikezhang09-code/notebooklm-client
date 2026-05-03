/**
 * Minimal async handler + error wrapper for Express 4.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { SessionHeaderError } from './session-header.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof SessionHeaderError) {
    if (!res.headersSent) res.status(err.status).json({ error: err.message });
    return;
  }
  // Log full stack to stderr so it shows up in the dev terminal.
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[api] ${req.method} ${req.originalUrl} failed:\n${stack}`);
  if (res.headersSent) {
    try { res.end(); } catch { /* ignore */ }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
}
