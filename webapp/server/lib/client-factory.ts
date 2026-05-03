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

export async function withClient<T>(
  opts: WithClientOptions,
  fn: (client: NotebookClient) => Promise<T>,
): Promise<T> {
  const client = new NotebookClient();
  await client.connect({
    transport: 'auto',
    session: opts.session,
    proxy: resolveProxy(opts.proxy),
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
