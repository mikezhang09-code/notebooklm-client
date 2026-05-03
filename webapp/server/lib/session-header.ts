/**
 * Parse + validate the user-provided session from an inbound HTTP request.
 *
 * The client stores the session JSON (exported from `notebooklm export-session`)
 * in browser localStorage and sends it with every request via an HTTP header
 * (base64-encoded JSON). The server is fully stateless — no credentials are
 * persisted anywhere.
 */

import type { Request } from 'express';
import type { NotebookRpcSession } from 'notebooklm-client';

export const SESSION_HEADER = 'x-nblm-session';

export class SessionHeaderError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function decodeBase64(str: string): string {
  // Accept both base64 and base64url, and raw JSON.
  if (str.trim().startsWith('{')) return str;
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

export function parseSessionHeader(req: Request): NotebookRpcSession {
  const raw = req.header(SESSION_HEADER);
  if (!raw) {
    throw new SessionHeaderError(
      `Missing ${SESSION_HEADER} header. Import your session first.`,
    );
  }
  if (raw.length > 200_000) {
    throw new SessionHeaderError('Session header too large', 413);
  }
  let decoded: string;
  try {
    decoded = decodeBase64(raw);
  } catch {
    throw new SessionHeaderError('Malformed session header (not base64)');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new SessionHeaderError('Malformed session header (not JSON)');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new SessionHeaderError('Session must be an object');
  }
  // Support both raw session object and `{ session: {...} }` wrapper.
  const obj = parsed as Record<string, unknown>;
  const session = (obj['session'] as Record<string, unknown>) ?? obj;
  if (typeof session['at'] !== 'string' || typeof session['cookies'] !== 'string') {
    throw new SessionHeaderError(
      'Invalid session: must include "at" and "cookies" strings.',
    );
  }
  return session as unknown as NotebookRpcSession;
}
