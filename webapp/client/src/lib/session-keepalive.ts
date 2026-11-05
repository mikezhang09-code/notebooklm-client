/**
 * Keep the browser's stored NotebookLM session alive.
 *
 * The server is stateless: when it refreshes a stale token mid-request, the
 * refreshed session is discarded and the browser keeps sending the original.
 * Google's short-lived `__Secure-1PSIDTS` cookie then ages out (it needs a
 * rotation roughly every 10 minutes, which only /api/session/refresh performs),
 * and every NotebookLM call eventually fails with UNAUTHENTICATED (code 16).
 *
 * While the app is open, refresh the session every 10 minutes — and right away
 * when the tab regains focus after a longer gap — and save the result back.
 */
import { useEffect } from 'react';
import { apiJson } from './api';
import { getSession, saveSession, type StoredSession } from './session-store';

const INTERVAL_MS = 10 * 60 * 1000;
// Shared across tabs so several open tabs don't each rotate the cookies.
const LAST_KEY = 'nblm.session.refreshedAt';

function lastRefresh(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0;
  } catch {
    return 0;
  }
}

let inFlight: Promise<void> | null = null;

/** Refresh + persist the stored session. Best-effort; never throws. */
export function refreshStoredSession(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!getSession()) return Promise.resolve();
  if (!force && Date.now() - lastRefresh() < INTERVAL_MS) return Promise.resolve();
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  inFlight = apiJson<{ session: StoredSession }>('/api/session/refresh', {})
    .then(({ session }) => {
      if (session?.at && session.cookies) saveSession(session);
    })
    .catch((err) => {
      // A dead session is surfaced by the real calls (and the Session page);
      // the keepalive just stays quiet.
      console.warn('[session-keepalive] refresh failed:', err instanceof Error ? err.message : err);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useSessionKeepalive(): void {
  useEffect(() => {
    void refreshStoredSession();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshStoredSession();
    }, 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshStoredSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
