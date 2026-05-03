/**
 * TlsClientTransport — Tier 2: tls-client via Go shared library (all platforms, 99% fingerprint).
 *
 * Uses bogdanfinn/tls-client (Go + uTLS) through FFI bindings.
 * Produces near-perfect JA3/JA4 + HTTP/2 Akamai fingerprints.
 *
 * Requires `tlsclientwrapper` as an optional dependency:
 *   npm install tlsclientwrapper
 */

import { SessionError } from './errors.js';
import type { Transport, TransportRequest } from './transport.js';
import type { NotebookRpcSession } from './types.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface TlsClientTransportOptions {
  session: NotebookRpcSession;
  /** tls-client profile identifier. Default: 'chrome_131'. */
  profile?: string;
  /** Proxy URL (http, socks5, socks5h). Passed as proxyUrl to tls-client. */
  proxy?: string;
  onSessionExpired?: () => Promise<NotebookRpcSession>;
}

// Lazy-loaded module references (optional dependency).
//
// Two API shapes are supported:
//   - Legacy (≤1.0.2, unpublished): named exports `ModuleClient` + `SessionClient`.
//   - Current (1.0.3+): default export `TlsClient` (single combined class).
interface LegacyModule {
  ModuleClient: new (opts: { maxThreads?: number }) => ModuleClientInstance;
  SessionClient: new (module: ModuleClientInstance, opts: Record<string, unknown>) => SessionClientInstance;
}

interface CurrentModule {
  default: new (opts: Record<string, unknown>) => SessionClientInstance;
}

type TlsClientModule = LegacyModule | CurrentModule;

interface ModuleClientInstance {
  terminate(): Promise<void>;
}

/**
 * Common session-client surface used by both API shapes. `terminate` is present
 * on 1.0.3+; `destroySession` is the legacy name. One or both may exist.
 */
interface SessionClientInstance {
  post(url: string, body: string, opts?: Record<string, unknown>): Promise<TlsClientResponse>;
  get(url: string, opts?: Record<string, unknown>): Promise<TlsClientResponse>;
  destroySession?(): Promise<void>;
  terminate?(): Promise<void> | void;
}

interface TlsClientResponse {
  status: number;
  body: string;
  headers?: Record<string, string[] | string>;
}

function isLegacyModule(mod: TlsClientModule): mod is LegacyModule {
  return (
    typeof (mod as LegacyModule).ModuleClient === 'function' &&
    typeof (mod as LegacyModule).SessionClient === 'function'
  );
}

function isCurrentModule(mod: TlsClientModule): mod is CurrentModule {
  return typeof (mod as CurrentModule).default === 'function';
}

export class TlsClientTransport implements Transport {
  private session: NotebookRpcSession;
  private profile: string;
  private proxy?: string;
  private onSessionExpired?: () => Promise<NotebookRpcSession>;
  private moduleClient: ModuleClientInstance | null = null;
  private sessionClient: SessionClientInstance | null = null;

  constructor(opts: TlsClientTransportOptions) {
    this.session = opts.session;
    this.profile = opts.profile ?? 'chrome_131';
    this.proxy = opts.proxy;
    this.onSessionExpired = opts.onSessionExpired;
  }

  async init(): Promise<void> {
    const mod = await TlsClientTransport.loadModule();
    if (!mod) throw new Error('tlsclientwrapper not installed. Run: npm install tlsclientwrapper');

    const clientOptions: Record<string, unknown> = {
      tlsClientIdentifier: this.profile,
      timeoutSeconds: 60,
      ...(this.proxy ? { proxyUrl: this.proxy } : {}),
      followRedirects: false,
      headerOrder: [
        'content-type',
        'user-agent',
        'cookie',
        'origin',
        'referer',
        'accept',
        'accept-language',
        'sec-ch-ua',
        'sec-ch-ua-mobile',
        'sec-ch-ua-platform',
        'sec-fetch-dest',
        'sec-fetch-mode',
        'sec-fetch-site',
        'x-same-domain',
      ],
    };

    if (isLegacyModule(mod)) {
      this.moduleClient = new mod.ModuleClient({ maxThreads: 2 });
      this.sessionClient = new mod.SessionClient(this.moduleClient, clientOptions);
    } else if (isCurrentModule(mod)) {
      this.sessionClient = new mod.default(clientOptions);
    } else {
      throw new Error('tlsclientwrapper module shape not recognised');
    }
  }

  async execute(req: TransportRequest): Promise<string> {
    if (!this.sessionClient) throw new SessionError('TlsClient transport not initialized');

    const doCall = async (): Promise<string> => {
      const qp = new URLSearchParams(req.queryParams).toString();
      const url = `${req.url}?${qp}`;
      const body = new URLSearchParams(req.body).toString();
      const headers = this.buildHeaders(body.length);

      const response = await this.sessionClient!.post(url, body, {
        headers,
      });

      if (response.status === 401 || response.status === 400) {
        throw new SessionError(`HTTP ${response.status}`);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.body.slice(0, 200)}`);
      }

      return response.body;
    };

    try {
      return await doCall();
    } catch (err) {
      if (err instanceof SessionError && this.onSessionExpired) {
        await this.refreshSession();
        return doCall();
      }
      throw err;
    }
  }

  getSession(): NotebookRpcSession {
    return this.session;
  }

  async refreshSession(): Promise<void> {
    if (!this.onSessionExpired) {
      throw new SessionError('Session expired and no refresh callback provided.');
    }
    console.error('NotebookLM: Refreshing session (tls-client)...');
    this.session = await this.onSessionExpired();
    console.error('NotebookLM: Session refreshed');
  }

  async dispose(): Promise<void> {
    if (this.sessionClient) {
      try {
        if (typeof this.sessionClient.destroySession === 'function') {
          await this.sessionClient.destroySession();
        } else if (typeof this.sessionClient.terminate === 'function') {
          await this.sessionClient.terminate();
        }
      } catch { /* ignore */ }
      this.sessionClient = null;
    }
    if (this.moduleClient) {
      try { await this.moduleClient.terminate(); } catch { /* ignore */ }
      this.moduleClient = null;
    }
  }

  updateSession(session: NotebookRpcSession): void {
    this.session = session;
  }

  private buildHeaders(contentLength: number): Record<string, string> {
    const ua = this.session.userAgent || DEFAULT_USER_AGENT;
    return {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Content-Length': String(contentLength),
      'User-Agent': ua,
      'Cookie': this.session.cookies,
      'Origin': 'https://notebooklm.google.com',
      'Referer': 'https://notebooklm.google.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'X-Same-Domain': '1',
    };
  }

  // ── Static Detection ──

  /** Check if tlsclientwrapper package is installed with a supported API. */
  static async isAvailable(): Promise<boolean> {
    const mod = await TlsClientTransport.loadModule();
    if (!mod) return false;
    return isLegacyModule(mod) || isCurrentModule(mod);
  }

  private static async loadModule(): Promise<TlsClientModule | null> {
    try {
      const mod = (await import('tlsclientwrapper')) as TlsClientModule;
      return mod;
    } catch {
      return null;
    }
  }
}
