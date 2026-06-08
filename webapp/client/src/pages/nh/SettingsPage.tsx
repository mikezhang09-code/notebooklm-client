/**
 * Settings — Session + Diagnose. Wired to real session state, the theme store,
 * and GET /api/corpus/health for subsystem status pills.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useTheme } from '../../lib/theme';
import { apiGet } from '../../lib/api';
import { hasSession, clearSession } from '../../lib/session-store';
import { toast } from '../../lib/toast';
import {
  getIndexStatus,
  listUnchunked,
  backfillIndex,
  type IndexStatus,
  type UnchunkedItem,
} from '../../lib/corpus-index';

function HealthPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`health-pill ${ok ? 'ok' : 'bad'}`}>
      <span className="hd" />
      {label}
    </span>
  );
}

interface CorpusHealth {
  enabled?: boolean;
  db?: { ok?: boolean };
  storage?: { ok?: boolean };
  genai?: { ok?: boolean; model?: string };
  chat?: { enabled?: boolean; provider?: string };
}

export default function SettingsPage({ tab }: { tab: 'session' | 'diagnose' }) {
  const [theme, toggleTheme] = useTheme();

  if (tab === 'diagnose') return <Diagnose />;

  return (
    <div className="content">
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: 'var(--accent)' }} />
          Settings · Session
        </div>
        <div className="view-title">
          <h1>Session</h1>
        </div>
      </div>

      <div className="set-card">
        <h3>Account</h3>
        <p className="s-d">Your NotebookLM session is stored only in this browser.</p>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-nlm" />
          </span>
          <span className="s-main">
            <b>Google NotebookLM</b>
            <small>Bring-your-own-session</small>
          </span>
          <HealthPill ok={hasSession()} label={hasSession() ? 'Linked' : 'Not linked'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id={theme === 'light' ? 'i-sun' : 'i-moon'} />
          </span>
          <span className="s-main">
            <b>Appearance</b>
            <small>Theme · {theme}</small>
          </span>
          <button className="btn btn-soft" onClick={toggleTheme}>
            Switch to {theme === 'light' ? 'dark' : 'light'}
          </button>
        </div>
      </div>

      <div className="set-card">
        <h3>Danger zone</h3>
        <p className="s-d">Removes the saved session from this browser. You'll need to paste it again.</p>
        <button
          className="btn btn-soft"
          style={{ color: 'var(--accent)' }}
          onClick={() => {
            if (confirm('Clear the saved session from this browser?')) {
              clearSession();
              location.reload();
            }
          }}
        >
          <Icon id="i-trash" /> Sign out (clear session)
        </button>
      </div>
    </div>
  );
}

function Diagnose() {
  const [health, setHealth] = useState<CorpusHealth | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean }>('/api/health')
      .then((r) => setServerOk(!!r.ok))
      .catch(() => setServerOk(false));
    apiGet<CorpusHealth>('/api/corpus/health')
      .then(setHealth)
      .catch(() => setHealth({ enabled: false }));
  }, []);

  return (
    <div className="content">
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: 'var(--accent)' }} />
          Settings · Diagnose
        </div>
        <div className="view-title">
          <h1>Diagnose</h1>
        </div>
        <p className="view-sub">Health of each subsystem this app depends on.</p>
      </div>

      <div className="set-card">
        <h3>System status</h3>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-pulse" />
          </span>
          <span className="s-main">
            <b>Web server</b>
            <small>Express API</small>
          </span>
          <HealthPill ok={!!serverOk} label={serverOk == null ? '…' : serverOk ? 'OK' : 'Down'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-nlm" />
          </span>
          <span className="s-main">
            <b>NotebookLM session</b>
            <small>Local credentials</small>
          </span>
          <HealthPill ok={hasSession()} label={hasSession() ? 'OK' : 'Missing'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-layers" />
          </span>
          <span className="s-main">
            <b>Embeddings</b>
            <small>{health?.genai?.model ?? 'Vector model'}</small>
          </span>
          <HealthPill ok={!!health?.genai?.ok} label={health?.genai?.ok ? 'OK' : 'Off'} />
        </div>
        <div className="set-row">
          <span className="s-ic">
            <Icon id="i-grid" />
          </span>
          <span className="s-main">
            <b>Vector database</b>
            <small>Oracle ADB</small>
          </span>
          <HealthPill ok={!!health?.db?.ok} label={health?.db?.ok ? 'OK' : 'Off'} />
        </div>
      </div>

      {health?.enabled !== false && <SearchIndexCard />}
    </div>
  );
}

/** Mime/kind → short hint shown next to a pending item. */
function pendingHint(it: UnchunkedItem): string {
  const m = (it.mimeType ?? '').toLowerCase();
  if (m.includes('pdf') || m.startsWith('image/')) return 'OCR';
  return it.kind;
}

function ItemList({ items, hint }: { items: UnchunkedItem[]; hint?: (it: UnchunkedItem) => string }) {
  const shown = items.slice(0, 12);
  return (
    <ul className="idx-list">
      {shown.map((it) => (
        <li key={it.id} title={it.title}>
          <span className="idx-nm">{it.title}</span>
          {hint && <span className="idx-hint">{hint(it)}</span>}
        </li>
      ))}
      {items.length > shown.length && (
        <li className="idx-more">+{items.length - shown.length} more</li>
      )}
    </ul>
  );
}

/**
 * Search index health + backfill. Shows how many documents are indexed,
 * splits the un-chunked ones into "needs indexing" (backfillable) vs
 * "awaiting transcription / no text", and streams a live backfill.
 */
function SearchIndexCard() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [groups, setGroups] = useState<{ fixable: UnchunkedItem[]; media: UnchunkedItem[] } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; line: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function refresh() {
    try {
      const [s, g] = await Promise.all([getIndexStatus(), listUnchunked()]);
      setStatus(s);
      setGroups(g);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, []);

  async function runBackfill() {
    if (running) return;
    setRunning(true);
    setProgress({ index: 0, total: groups?.fixable.length ?? 0, line: 'Starting…' });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await backfillIndex(
        {
          onProgress: (p) =>
            setProgress({ index: p.index, total: p.total, line: `[${p.status}] ${p.message}` }),
          onResult: (r) => {
            const n = r.tally['indexed'] ?? 0;
            const noText = r.tally['no-text'] ?? 0;
            const failed =
              (r.tally['embed-failed'] ?? 0) + (r.tally['ocr-failed'] ?? 0) + (r.tally['fetch-failed'] ?? 0);
            toast(
              `Indexed ${n} document${n === 1 ? '' : 's'}` +
                (noText ? `, ${noText} had no text` : '') +
                (failed ? `, ${failed} failed` : ''),
            );
          },
          onError: (m) => toast(`Backfill error: ${m}`),
        },
        ctrl.signal,
      );
    } catch {
      /* onError already surfaced it */
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
      void refresh();
    }
  }

  const fixable = groups?.fixable ?? [];
  const media = groups?.media ?? [];
  const allIndexed = !!status && status.fixable === 0;

  return (
    <div className="set-card">
      <h3>Search index</h3>
      <p className="s-d">
        Uploaded files and saved artifacts are chunked and embedded so they're searchable.
        {status ? ` Embedding provider: ${status.provider}.` : ''}
      </p>

      {loadErr && <p className="hint" style={{ color: 'var(--accent)' }}>{loadErr}</p>}

      <div className="set-row">
        <span className="s-ic">
          <Icon id="i-layers" />
        </span>
        <span className="s-main">
          <b>{status ? `${status.chunked} of ${status.total} documents indexed` : 'Checking…'}</b>
          <small>
            {status
              ? allIndexed
                ? 'Everything searchable'
                : `${status.fixable} need indexing${status.media ? `, ${status.media} awaiting transcription` : ''}`
              : ''}
          </small>
        </span>
        <HealthPill ok={allIndexed} label={allIndexed ? 'All indexed' : `${status?.fixable ?? 0} pending`} />
      </div>

      {fixable.length > 0 && (
        <div className="idx-group">
          <div className="idx-group-head">
            <b>Needs indexing ({fixable.length})</b>
            <button className="btn btn-primary" disabled={running} onClick={runBackfill}>
              {running ? 'Backfilling…' : 'Backfill now'}
            </button>
          </div>
          <ItemList items={fixable} hint={pendingHint} />
        </div>
      )}

      {running && progress && (
        <div className="idx-progress">
          <div className="idx-bar">
            <span
              style={{ width: `${progress.total ? (progress.index / progress.total) * 100 : 0}%` }}
            />
          </div>
          <small className="idx-pline">
            {progress.index}/{progress.total} · {progress.line}
          </small>
        </div>
      )}

      {media.length > 0 && (
        <div className="idx-group">
          <div className="idx-group-head">
            <b>No text yet / media ({media.length})</b>
          </div>
          <p className="hint" style={{ margin: '0 0 6px' }}>
            Audio &amp; video get indexed automatically after transcription — no action needed.
          </p>
          <ItemList items={media} />
        </div>
      )}
    </div>
  );
}
