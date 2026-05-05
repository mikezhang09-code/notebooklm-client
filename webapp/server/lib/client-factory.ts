/**
 * Build a connected NotebookClient for the duration of a request, using the
 * session supplied by the caller. Always uses the 'auto' transport so it picks
 * the strongest available TLS fingerprint (curl-impersonate > tls-client > undici).
 */

import { NotebookClient } from 'notebooklm-client';
import type { NotebookRpcSession } from 'notebooklm-client';

export interface WithClientOptions {
  session: NotebookRpcSession;
  /** Optional proxy URL. Defaults to env HTTPS_PROXY/ALL_PROXY if set. */
  proxy?: string;
  /**
   * Per-request read timeout (seconds) for the underlying HTTP transport.
   * Honoured by the tls-client tier (Windows tier-2), which ships with a
   * 60-second default inside the library — far too short for long chat
   * answers. Overridable per-call, or globally via the
   * `NOTEBOOKLM_CLIENT_TIMEOUT_SECONDS` env var. Default: 180.
   */
  timeoutSeconds?: number;
}

function resolveProxy(explicit?: string): string | undefined {
  return (
    explicit ??
    process.env['HTTPS_PROXY'] ??
    process.env['https_proxy'] ??
    process.env['ALL_PROXY'] ??
    process.env['all_proxy']
  );
}

/**
 * Resolve the tls-client read timeout, in seconds.
 *
 * Precedence: explicit call-site value → env override → 180s default.
 *
 * The 180s floor was picked empirically: NotebookLM chat with 30-50
 * sources and Chinese prompts routinely takes 60-120s to stream back a
 * full answer. The library's own default of 60s was triggering
 * `net/http: request canceled (Client.Timeout or context cancellation
 * while reading body)` on realistic loads.
 */
function resolveTimeoutSeconds(explicit?: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  const raw = process.env['NOTEBOOKLM_CLIENT_TIMEOUT_SECONDS'];
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 180;
}

export async function withClient<T>(
  opts: WithClientOptions,
  fn: (client: NotebookClient) => Promise<T>,
): Promise<T> {
  const client = new NotebookClient();
  await client.connect({
    transport: 'auto',
    session: opts.session,
    proxy: resolveProxy(opts.proxy),
    timeoutSeconds: resolveTimeoutSeconds(opts.timeoutSeconds),
  });
  try {
    return await fn(client);
  } finally {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
