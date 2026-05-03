/**
 * localStorage wrapper for the user's NotebookLM session JSON.
 * The session is sent with every API request via the X-NBLM-Session header.
 */

const KEY = 'nblm.session';

export interface StoredSession {
  at: string;
  bl?: string;
  fsid?: string;
  cookies: string;
  userAgent?: string;
  language?: string;
  cookieJar?: unknown[];
}

let cache: StoredSession | null | undefined;

function readStorage(): StoredSession | null {
  if (cache !== undefined) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      cache = null;
      return null;
    }
    const parsed = JSON.parse(raw) as { session?: StoredSession } | StoredSession;
    const session = (parsed as { session?: StoredSession }).session ?? (parsed as StoredSession);
    cache = session;
    return session;
  } catch {
    cache = null;
    return null;
  }
}

export function getSession(): StoredSession | null {
  return readStorage();
}

export function hasSession(): boolean {
  return !!readStorage();
}

export function saveSession(session: StoredSession): void {
  cache = session;
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  cache = null;
  localStorage.removeItem(KEY);
}

/** Base64-encode the session JSON for the X-NBLM-Session header. */
export function encodeSessionHeader(session: StoredSession): string {
  const json = JSON.stringify(session);
  // Use btoa with a Unicode-safe wrapper.
  const utf8 = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary);
}
