/**
 * Lightweight server-side diagnose endpoint — mirrors the CLI diagnose command
 * but omits local-filesystem-specific items (profile dir, rpc overrides, etc.).
 */

import { Router } from 'express';
import { platform, arch, release } from 'node:os';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';

export const diagnoseRouter = Router();

diagnoseRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const info: Record<string, unknown> = {
      server: {
        platform: `${platform()}-${arch()}`,
        osRelease: release(),
        node: process.version,
      },
      transport: {},
      api: { status: 'skipped', reason: 'no session header' },
    };

    try {
      const { CurlTransport, TlsClientTransport } = await import('notebooklm-client');
      const hasCurl = await CurlTransport.isAvailable();
      const hasTls = await TlsClientTransport.isAvailable();
      info.transport = {
        curlImpersonate: hasCurl,
        tlsClient: hasTls,
        undici: true,
        autoSelect: hasCurl ? 'curl-impersonate' : hasTls ? 'tls-client' : 'undici',
      };
    } catch (err) {
      info.transport = { error: err instanceof Error ? err.message : String(err) };
    }

    // Only try the API test if a session is supplied.
    try {
      const session = parseSessionHeader(req);
      const result = await withClient({ session }, async (client) => {
        const notebooks = await client.listNotebooks();
        let account: unknown = null;
        try {
          account = await client.getAccountInfo();
        } catch {
          /* best-effort */
        }
        return { notebookCount: notebooks.length, account };
      });
      info.api = { status: 'ok', ...result };
    } catch (err) {
      info.api = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    res.json(info);
  }),
);
