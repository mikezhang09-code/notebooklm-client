import { useState } from 'react';
import { apiJson } from '../lib/api';
import { clearSession, getSession, saveSession, type StoredSession } from '../lib/session-store';

interface RefreshResponse {
  session: StoredSession;
}

interface VerifyResponse {
  ok: boolean;
  notebookCount: number;
  account?: { isPlus?: boolean; planType?: number; notebookLimit?: number; sourceLimit?: number } | null;
}

export default function SessionPage() {
  const current = getSession();
  const [busy, setBusy] = useState<null | 'verify' | 'refresh'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleVerify() {
    setBusy('verify');
    setMsg(null);
    setErr(null);
    try {
      const res = await apiJson<VerifyResponse>('/api/session/verify', {});
      setMsg(
        `OK — ${res.notebookCount} notebook${res.notebookCount === 1 ? '' : 's'}` +
          (res.account ? ` · ${res.account.isPlus ? 'Plus' : 'Free'} plan` : ''),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy('refresh');
    setMsg(null);
    setErr(null);
    try {
      const { session } = await apiJson<RefreshResponse>('/api/session/refresh', {});
      saveSession(session);
      setMsg(`Refreshed (at=${session.at.slice(0, 20)}…)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function handleExport() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'session.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleClear() {
    if (!confirm('Clear the session from this browser?')) return;
    clearSession();
    window.location.href = '/';
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Session</h1>

      <div className="card space-y-2">
        <div className="text-sm text-slate-600">
          The session JSON is stored only in this browser. It is sent with every API call as an{' '}
          <code>X-NBLM-Session</code> header.
        </div>
        {current && (
          <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Access token</dt>
            <dd className="truncate font-mono text-xs text-slate-800">{current.at.slice(0, 40)}…</dd>
            <dt className="text-slate-500">Build label</dt>
            <dd className="truncate font-mono text-xs text-slate-800">{current.bl ?? '—'}</dd>
            <dt className="text-slate-500">Language</dt>
            <dd className="font-mono text-xs text-slate-800">{current.language ?? '—'}</dd>
          </dl>
        )}
        <div className="flex flex-wrap gap-2 pt-3">
          <button type="button" className="btn-primary" onClick={handleVerify} disabled={busy !== null}>
            {busy === 'verify' ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleRefresh} disabled={busy !== null}>
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh tokens'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleExport}>
            Download session.json
          </button>
          <button type="button" className="btn-danger ml-auto" onClick={handleClear}>
            Clear session
          </button>
        </div>
        {msg && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {msg}
          </div>
        )}
        {err && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </div>
        )}
      </div>

      <div className="card text-sm text-slate-600">
        <div className="mb-1 font-semibold text-slate-800">Need a new session?</div>
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            Run{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">
              npx notebooklm-client export-session
            </code>{' '}
            on your own machine.
          </li>
          <li>
            Open{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">
              ~/.notebooklm/session.json
            </code>
            .
          </li>
          <li>Clear the session above and paste the new one.</li>
        </ol>
      </div>
    </div>
  );
}
