import { useState } from 'react';
import { saveSession } from '../lib/session-store';
import type { StoredSession } from '../lib/session-store';
import { apiJson } from '../lib/api';
import { Icon } from './Icon';

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

  async function verifyAndSave(sessionJson: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sessionJson);
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await verifyAndSave(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadFromDisk() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/session/local');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { session: StoredSession };
      const sessionJson = JSON.stringify(data, null, 2);
      setRaw(sessionJson);
      // Auto-verify the loaded session.
      await verifyAndSave(sessionJson);
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
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div className="view-head" style={{ textAlign: 'center' }}>
          <div className="view-title" style={{ justifyContent: 'center' }}>
            <h1>
              Notebook<span style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic', fontWeight: 500, color: 'var(--accent)' }}>Hub</span>
            </h1>
          </div>
          <p className="view-sub" style={{ margin: '8px auto 0' }}>
            A calm workspace for <code>notebooklm-client</code>. Bring your own session.
          </p>
        </div>

        <div className="set-card" style={{ maxWidth: 'none' }}>
          <h3>Import your session</h3>
          <p className="s-d">
            On your machine run <code>npx notebooklm export-session</code>, then load it below.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={busy}
            onClick={handleLoadFromDisk}
          >
            <Icon id="i-download" />
            {busy ? 'Loading…' : 'Load from disk (auto-detect session.json)'}
          </button>

          <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
            <div className="field">
              <label>Session JSON</label>
              <textarea
                className="input"
                style={{ minHeight: 150, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                placeholder='{"at":"...","bl":"...","fsid":"...","cookies":"...","userAgent":"..."}'
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                disabled={busy}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <input
                type="file"
                accept="application/json,.json,.txt"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: 13, color: 'var(--muted)' }}
                disabled={busy}
              />
              <div style={{ flex: 1 }} />
              <button type="submit" className="btn btn-primary" disabled={busy || !raw.trim()}>
                {busy ? 'Verifying…' : 'Verify & save'}
              </button>
            </div>
            {error && (
              <p className="hint" style={{ color: 'var(--accent)', marginTop: 12 }}>
                {error}
              </p>
            )}
            {info && (
              <p className="hint" style={{ color: '#5f8a5a', marginTop: 12 }}>
                {info}
              </p>
            )}
          </form>

          <p className="s-d" style={{ marginTop: 16, marginBottom: 0 }}>
            Stored only in this browser's <code>localStorage</code>; sent per-request in an{' '}
            <code>X-NBLM-Session</code> header, never persisted on the server.
          </p>
        </div>
      </div>
    </div>
  );
}

