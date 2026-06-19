/**
 * Export a collection into a *persistent* NotebookLM notebook — one source per
 * compatible artifact (vs. "Generate", which folds the files into a single
 * throwaway text source).
 *
 * Image-only artifacts (infographics, image diagrams) can't be useful
 * NotebookLM sources, so they're unchecked by default. Everything else becomes
 * a file upload (docs/PDF/audio) or a text source (notes, reports, etc.).
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { streamSse } from '../lib/api';
import { describe } from '../lib/registry';
import type { CollectionFile } from '../lib/collections';
import { toast } from '../lib/toast';

type LogLine = { kind: 'info' | 'prog' | 'done' | 'error'; text: string; ts: string };

interface ExportResult {
  notebookId?: string;
  notebookUrl?: string;
  name?: string;
  added?: { title: string; mode: string }[];
  failed?: { title: string; error: string }[];
  skipped?: { id: string; title: string; reason: string }[];
  capped?: boolean;
}

/** Images can't be useful NotebookLM sources — unchecked by default. */
function isImageOnly(f: CollectionFile): boolean {
  const m = (f.mimeType ?? '').toLowerCase();
  return m.startsWith('image/') || f.kind === 'infographic' || f.kind === 'diagram';
}

const SKIP_REASON_LABEL: Record<string, string> = {
  image: 'image — skipped',
  empty: 'no extractable text — skipped',
  over_limit: 'over the 50-source limit — skipped',
};

export default function ExportToNotebookDrawer({
  collectionId,
  collectionName,
  files,
  onClose,
  onDone,
}: {
  collectionId: string;
  collectionName: string;
  files: CollectionFile[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [name, setName] = useState(collectionName);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(files.filter((f) => !isImageOnly(f)).map((f) => f.id)),
  );
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<ExportResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const imageCount = useMemo(() => files.filter(isImageOnly).length, [files]);

  function addLog(kind: LogLine['kind'], text: string) {
    setLog((l) => [...l, { kind, text, ts: new Date().toLocaleTimeString() }]);
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fileIds = [...selected];
  const canRun = fileIds.length > 0 && !busy && name.trim().length > 0;

  async function run() {
    setBusy(true);
    setLog([]);
    setResult(null);
    try {
      const form = new FormData();
      form.append('payload', JSON.stringify({ fileIds, name: name.trim() }));
      const controller = new AbortController();
      abortRef.current = controller;
      addLog('info', 'Request sent; streaming progress…');
      await streamSse(
        `/api/corpus/collections/${collectionId}/export-notebook`,
        form,
        {
          onProgress: (p) => addLog('prog', `[${p.status}] ${p.message}`),
          onResult: (d) => {
            setResult(d as ExportResult);
            addLog('done', 'Done.');
            onDone?.();
          },
          onError: (m) => {
            addLog('error', m);
            toast(m);
          },
        },
        controller.signal,
      );
    } catch (err) {
      addLog('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': 'var(--accent)' } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-book" />
          </span>
          <div className="d-tt">
            <b>Export to NotebookLM</b>
            <small>One NotebookLM source per file</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div className="drawer-body">
          <p className="hint">
            Creates a new NotebookLM notebook and adds each selected file as its own
            source — preserving per-source citations. Up to 50 sources.
          </p>

          <div className="field">
            <label>Notebook name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field">
            <label>
              Files · {selected.size}/{files.length} selected
            </label>
            {files.length === 0 ? (
              <p className="hint">This collection has no files yet.</p>
            ) : (
              <div
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: 'var(--card-2)',
                }}
              >
                {files.map((f) => {
                  const face = describe(f.kind, f.mimeType, f.title);
                  const on = selected.has(f.id);
                  const img = isImageOnly(f);
                  return (
                    <label
                      key={f.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--line-soft)',
                        cursor: 'pointer',
                        opacity: img ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(f.id)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span style={{ color: face.color, display: 'inline-flex' }}>
                        <Icon id={face.icon} />
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {face.label}
                        {img ? ' · image' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {imageCount > 0 && (
              <p className="hint" style={{ marginTop: 6 }}>
                Image-only items (infographics, image diagrams) can't be NotebookLM sources and are unchecked by default.
              </p>
            )}
          </div>

          {log.length > 0 && (
            <div className="proglog">
              {log.map((l, i) => (
                <div key={i} className={`ln ${l.kind === 'prog' ? 'prog' : l.kind}`}>
                  <span className="tk">{l.ts}</span>
                  <span className="msg">{l.text}</span>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="result">
              <h4>Result</h4>
              <p className="hint">
                Added {result.added?.length ?? 0} source{(result.added?.length ?? 0) !== 1 ? 's' : ''}
                {result.failed && result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}
                {result.skipped && result.skipped.length > 0 ? ` · ${result.skipped.length} skipped` : ''}
                {result.capped ? ' · capped at 50' : ''}
              </p>
              {result.skipped && result.skipped.length > 0 && (
                <ul className="hint" style={{ margin: '6px 0', paddingLeft: 18 }}>
                  {result.skipped.map((s) => (
                    <li key={s.id}>
                      {s.title} — {SKIP_REASON_LABEL[s.reason] ?? s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {result.failed && result.failed.length > 0 && (
                <ul className="hint" style={{ margin: '6px 0', paddingLeft: 18, color: 'var(--accent)' }}>
                  {result.failed.map((f, i) => (
                    <li key={i}>
                      {f.title} — {f.error}
                    </li>
                  ))}
                </ul>
              )}
              {result.notebookUrl && (
                <a
                  className="btn btn-primary"
                  href={result.notebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginTop: 10 }}
                >
                  <Icon id="i-link" /> Open in NotebookLM
                </a>
              )}
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={!canRun} onClick={run}>
            {busy ? <span className="spinner" /> : <Icon id="i-book" />}
            {busy ? 'Exporting…' : result ? 'Export again' : 'Export to NotebookLM'}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </aside>
    </>
  );
}
