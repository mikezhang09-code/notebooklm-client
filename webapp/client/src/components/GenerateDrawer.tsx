/**
 * Generate drawer (notebook-scoped). A right slide-in that picks sources from a
 * notebook, exposes the per-type option spec, and streams generation progress
 * via POST /api/generate/:kind { notebookId, sourceIds, options }.
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { streamSse } from '../lib/api';
import {
  GEN_SPEC,
  LANGS,
  LANG_CODE,
  TYPE,
  toBackendValue,
  type TypeKey,
} from '../lib/registry';
import { toast } from '../lib/toast';

export interface DrawerSource {
  id: string;
  title: string;
  ext?: string;
}

type LogLine = { kind: 'info' | 'prog' | 'done' | 'error'; text: string; ts: string };

interface ResultData {
  jobId?: string;
  downloads?: { name: string; url: string }[];
  meta?: Record<string, unknown>;
}

export default function GenerateDrawer({
  typeKey,
  notebookId,
  sources,
  onClose,
  onDone,
}: {
  typeKey: TypeKey;
  notebookId: string;
  sources: DrawerSource[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = TYPE[typeKey];
  const spec = GEN_SPEC[typeKey];

  const defaults = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of spec.fields) o[f.key] = f.opts[0] ?? '';
    return o;
  }, [spec]);

  const [opts, setOpts] = useState<Record<string, string>>(defaults);
  const [instructions, setInstructions] = useState('');
  const [lang, setLang] = useState('English');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function addLog(kind: LogLine['kind'], text: string) {
    setLog((l) => [...l, { kind, text, ts: new Date().toLocaleTimeString() }]);
  }
  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function run() {
    if (selected.size === 0) return;
    setBusy(true);
    setLog([]);
    setResult(null);
    try {
      const options: Record<string, string> = {};
      for (const f of spec.fields) if (opts[f.key]) options[f.key] = toBackendValue(opts[f.key]);
      if (instructions.trim()) options.instructions = instructions.trim();
      if (spec.language) options.language = LANG_CODE[lang] ?? 'en';

      const form = new FormData();
      form.append(
        'payload',
        JSON.stringify({ notebookId, sourceIds: [...selected], options }),
      );

      const controller = new AbortController();
      abortRef.current = controller;
      addLog('info', 'Request sent; streaming progress…');
      await streamSse(
        `/api/generate/${t.backendKind}`,
        form,
        {
          onProgress: (p) => addLog('prog', `[${p.status}] ${p.message}`),
          onResult: (d) => {
            setResult(d as ResultData);
            addLog('done', 'Completed.');
            toast(`${t.label} generated`);
            onDone?.();
          },
          onError: (m) => addLog('error', m),
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

  const allSelected = selected.size === sources.length && sources.length > 0;

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': t.color } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id={t.icon} />
          </span>
          <div className="d-tt">
            <b>Generate {t.label}</b>
            <small>From this notebook's sources</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Source checklist */}
          <div className="field">
            <div className="spread" style={{ marginBottom: 8 }}>
              <label style={{ margin: 0 }}>
                Sources · {selected.size} of {sources.length}
              </label>
              <button
                className="mini-link"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(sources.map((s) => s.id)))
                }
              >
                {allSelected ? 'Select none' : 'Select all'}
              </button>
            </div>
            <div className="src-list">
              {sources.map((s) => (
                <label key={s.id} className="src-pick">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="src-ic">
                    <Icon id="i-doc" />
                  </span>
                  <span className="src-name">
                    {s.title}
                    {s.ext && <small>{s.ext}</small>}
                  </span>
                  <span className="src-check">
                    <Icon id="i-check" />
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Per-type option fields */}
          {spec.fields.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              {f.opts.length <= 3 ? (
                <div className="seg">
                  {f.opts.map((o) => (
                    <button
                      key={o}
                      className={opts[f.key] === o ? 'on' : ''}
                      onClick={() => setOpts((p) => ({ ...p, [f.key]: o }))}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  className="selectbox"
                  value={opts[f.key]}
                  onChange={(e) => setOpts((p) => ({ ...p, [f.key]: e.target.value }))}
                >
                  {f.opts.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          {/* Instructions */}
          <div className="field">
            <label>Instructions (optional)</label>
            <textarea
              className="input"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Any specific guidance…"
            />
          </div>

          {/* Language */}
          {spec.language && (
            <div className="field">
              <label>Language</label>
              <select className="selectbox" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

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
              <h4>Output</h4>
              {result.downloads && result.downloads.length > 0 ? (
                result.downloads.map((d) => (
                  <a key={d.url} className="dl-row" href={d.url} download style={{ marginBottom: 6 }}>
                    <Icon id="i-download" />
                    {d.name}
                  </a>
                ))
              ) : (
                <p className="hint">
                  {typeof result.meta?.['streamUrl'] === 'string' ? (
                    <a href={result.meta['streamUrl'] as string} target="_blank" rel="noreferrer">
                      Open stream ↗
                    </a>
                  ) : (
                    'No downloadable file.'
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={run}>
            {busy ? <span className="spinner" /> : <Icon id={t.icon} />}
            {busy ? 'Generating…' : `Generate ${t.label}`}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </aside>
    </>
  );
}
