/**
 * Session management endpoints.
 *
 * The server never stores user credentials. These endpoints just validate a
 * user-supplied session JSON (by calling a cheap RPC) and/or refresh its
 * tokens using the bundled session-store helper — returning the refreshed
 * session to the caller so they can re-save it client-side.
 */

import { Router } from 'express';
import { refreshTokens, loadSession } from 'notebooklm-client';
import type { NotebookRpcSession } from 'notebooklm-client';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';

export const sessionRouter = Router();

/** POST /api/session/verify — calls listNotebooks() with the supplied session. */
sessionRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const notebooks = await withClient({ session }, (client) => client.listNotebooks());
    let account: unknown = null;
    try {
      account = await withClient({ session }, (client) => client.getAccountInfo());
    } catch {
      /* best-effort */
    }
    res.json({
      ok: true,
      notebookCount: notebooks.length,
      account,
    });
  }),
);

/**
 * GET /api/session/local — read the session.json from the default disk path.
 *
 * This lets the webapp auto-load the session after `npx notebooklm export-session`
 * without requiring the user to manually paste JSON. Only useful when the server
 * runs on the same machine as the session file (i.e. local dev).
 */
sessionRouter.get(
  '/local',
  asyncHandler(async (_req, res) => {
    const session = await loadSession();
    if (!session) {
      res.status(404).json({
        error: 'No local session found. Run: npx notebooklm export-session',
      });
      return;
    }
    res.json({ session });
  }),
);

/** POST /api/session/refresh — rotates tokens using the current cookies. */
sessionRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const proxy =
      process.env['HTTPS_PROXY'] ??
      process.env['https_proxy'] ??
      process.env['ALL_PROXY'] ??
      process.env['all_proxy'];
    // Pass `undefined` for the path — we never want to write a session file on the server.
    const refreshed: NotebookRpcSession = await refreshTokens(session, undefined, proxy);
    res.json({ session: refreshed });
  }),
);
