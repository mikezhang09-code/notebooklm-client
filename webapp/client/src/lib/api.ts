/**
 * Thin fetch wrapper — injects the session header from localStorage on every request.
 */

import { encodeSessionHeader, getSession } from './session-store';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const session = getSession();
  if (session) {
    headers.set('X-NBLM-Session', encodeSessionHeader(session));
  }
  return headers;
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const json = (await res.json()) as { error?: string };
      detail = json?.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'GET', headers: buildHeaders() });
  return unwrap<T>(res);
}

export async function apiJson<T>(path: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE', headers: buildHeaders() });
  return unwrap<T>(res);
}

export async function apiFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(), // let browser set multipart boundary
    body: form,
  });
  return unwrap<T>(res);
}

export interface SseHandlers {
  onProgress?: (p: { status: string; message: string }) => void;
  onResult?: (data: unknown) => void;
  onError?: (message: string) => void;
}

export interface JsonSseHandlers {
  onDelta?: (text: string) => void;
  onResult?: (data: unknown) => void;
  onError?: (message: string) => void;
}

/**
 * POST a JSON body and consume the SSE response. Handles `delta` (incremental
 * text), `result` (final payload), and `error` events. Used for streamed corpus
 * chat. Throws ApiError on a non-OK response (e.g. 503 when chat is disabled).
 */
export async function streamJsonSse(
  path: string,
  body: unknown,
  handlers: JsonSseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string })?.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  if (!res.body) {
    handlers.onError?.('Empty SSE response');
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join('\n');
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        if (event === 'error') handlers.onError?.(data);
        continue;
      }
      if (event === 'delta') {
        const text = (parsed as { text?: string })?.text;
        if (typeof text === 'string') handlers.onDelta?.(text);
      } else if (event === 'result') {
        handlers.onResult?.(parsed);
      } else if (event === 'error') {
        const msg =
          typeof parsed === 'object' && parsed && 'message' in parsed
            ? String((parsed as { message: string }).message)
            : String(data);
        handlers.onError?.(msg);
      }
    }
  }
}

/**
 * Stream a POST with SSE response. Uses fetch + ReadableStream because EventSource
 * does not support request bodies or custom headers across all browsers.
 */
export async function streamSse(
  path: string,
  form: FormData,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(),
    body: form,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    handlers.onError?.(text || `HTTP ${res.status}`);
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  if (!res.body) {
    handlers.onError?.('Empty SSE response');
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Parse SSE framing: blank-line-terminated blocks of `event:` / `data:` lines.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join('\n');
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        if (event === 'progress') handlers.onProgress?.(parsed);
        else if (event === 'result') handlers.onResult?.(parsed);
        else if (event === 'error') {
          const msg = typeof parsed === 'object' && parsed && 'message' in parsed
            ? String((parsed as { message: string }).message)
            : String(data);
          handlers.onError?.(msg);
        }
      } catch {
        if (event === 'error') handlers.onError?.(data);
      }
    }
  }
}
