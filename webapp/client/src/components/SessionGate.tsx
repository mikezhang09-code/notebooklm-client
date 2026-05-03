import { useState } from 'react';
import { saveSession } from '../lib/session-store';
import type { StoredSession } from '../lib/session-store';
import { apiJson } from '../lib/api';

interface Props {
  onSession: () => void;
}

interface VerifyResult {
  ok: boolean;
  notebookCount: number;
  account?: { isPlus?: boolean; planType?: number } | null;
}

export default function SessionGate({ onSession }: Props) {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('Not valid JSON. Paste the contents of your session.json file.');
      }
      const envelope = parsed as { session?: StoredSession } | StoredSession;
      const session = (envelope as { session?: StoredSession }).session ?? (envelope as StoredSession);
      if (!session || typeof session !== 'object' || !session.at || !session.cookies) {
        throw new Error('Session must contain at least "at" and "cookies" fields.');
      }
      // Temporarily save so apiJson picks it up from localStorage.
      saveSession(session);
      const result = await apiJson<VerifyResult>('/api/session/verify', {});
      setInfo(
        `Verified — ${result.notebookCount} notebook${result.notebookCount === 1 ? '' : 's'} accessible` +
          (result.account?.isPlus ? ' (Plus)' : ''),
      );
      onSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      setRaw(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50 p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-brand-700">NotebookLM GUI</h1>
          <p className="mt-2 text-slate-600">
            A friendly web interface for <code>notebooklm-client</code>. Bring your own session.
          </p>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Import your session</h2>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-slate-600">
            <li>
              On your own machine, run:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px]">
                npx notebooklm-client export-session
              </code>
            </li>
            <li>
              Open the resulting file (default:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px]">
                ~/.notebooklm/session.json
              </code>
              ).
            </li>
            <li>Paste its contents below, or upload the file.</li>
          </ol>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Session JSON</label>
              <textarea
                className="input h-40 font-mono text-xs"
                placeholder='{"at":"...","bl":"...","fsid":"...","cookies":"...","userAgent":"..."}'
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="application/json,.json,.txt"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="text-sm"
                disabled={busy}
              />
              <div className="flex-1" />
              <button type="submit" className="btn-primary" disabled={busy || !raw.trim()}>
                {busy ? 'Verifying…' : 'Verify & save'}
              </button>
            </div>
            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {info}
              </div>
            )}
          </form>

          <div className="border-t border-slate-200 pt-3 text-xs text-slate-500">
            Your session is stored only in this browser's <code>localStorage</code>. It is sent with
            each request in an <code>X-NBLM-Session</code> header and never persisted on the server.
          </div>
        </div>
      </div>
    </div>
  );
}
