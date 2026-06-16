/**
 * Build a connected NotebookClient for the duration of a request, using the
 * session supplied by the caller. Always uses the 'auto' transport so it picks
 * the strongest available TLS fingerprint (curl-impersonate > tls-client > undici).
 */

import { NotebookClient, refreshTokens } from 'notebooklm-client';
import type { NotebookRpcSession } from 'notebooklm-client';

export interface WithClientOptions {
  session: NotebookRpcSession;
  /** Optional proxy URL. Defaults to env HTTPS_PROXY/ALL_PROXY if set. */
  proxy?: string;
  /**
   * Rotate the session's auth token (via its cookies) before connecting. Worth
   * it ahead of long NotebookLM operations (generation), where a token valid at
   * request time can lapse mid-run and surface as UNAUTHENTICATED. Best-effort:
   * if the refresh call fails the original session is used, and a truly-dead
   * session still surfaces a clear auth error downstream.
   */
  refreshFirst?: boolean;
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
  const proxy = resolveProxy(opts.proxy);
  let session = opts.session;
  if (opts.refreshFirst) {
    try {
      session = await refreshTokens(session, undefined, proxy);
    } catch (err) {
      // Refresh may transiently fail on a still-valid session; proceed with the
      // original and let the real call surface any genuine auth error.
      console.warn(
        '[client-factory] pre-flight token refresh failed; using original session: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  const client = new NotebookClient();
  await client.connect({
    transport: 'auto',
    session,
    proxy,
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
