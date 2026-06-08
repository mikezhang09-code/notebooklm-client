/**
 * Standalone "Generate with AI" drawer — the Free Forms / Collections
 * counterpart to the notebook generate drawer. Takes a fresh source
 * (URL / Text / File / Research topic), streams generation via the CLI-backed
 * POST /api/generate/:kind (no notebookId → fresh notebook), then offers to
 * save the result into the library (free-form, or into a collection).
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { streamSse } from '../lib/api';
import { saveFromJob } from '../lib/artifacts';
import {
  GEN_SPEC,
  LANGS,
  LANG_CODE,
  TYPE,
  toBackendValue,
  type TypeKey,
} from '../lib/registry';
import { toast } from '../lib/toast';

type SourceMode = 'url' | 'text' | 'file' | 'research';
type LogLine = { kind: 'info' | 'prog' | 'done' | 'error'; text: string; ts: string };
interface ResultData {
  jobId?: string;
  downloads?: { name: string; url: string }[];
  primary?: string[];
  meta?: Record<string, unknown>;
}

export default function GenerateStandaloneDrawer({
  typeKey,
  collectionId,
  onClose,
  onDone,
}: {
  typeKey: TypeKey;
  collectionId?: string;
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

  const [mode, setMode] = useState<SourceMode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [researchMode, setResearchMode] = useState<'fast' | 'deep'>('fast');
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<Record<string, string>>(defaults);
  const [instructions, setInstructions] = useState('');
  const [lang, setLang] = useState('English');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function addLog(kind: LogLine['kind'], text: string) {
    setLog((l) => [...l, { kind, text, ts: new Date().toLocaleTimeString() }]);
  }

  const canGenerate =
    mode === 'url' ? !!url.trim() : mode === 'text' ? !!text.trim() : mode === 'file' ? !!file : !!topic.trim();

  async function run() {
    setBusy(true);
    setLog([]);
    setResult(null);
    setSaved(false);
    try {
      const options: Record<string, string> = {};
      for (const f of spec.fields) if (opts[f.key]) options[f.key] = toBackendValue(opts[f.key]);
      if (instructions.trim()) options.instructions = instructions.trim();
      if (spec.language) options.language = LANG_CODE[lang] ?? 'en';

      const source =
        mode === 'url'
          ? { type: 'url', url: url.trim() }
          : mode === 'text'
            ? { type: 'text', text: text.trim() }
            : mode === 'research'
              ? { type: 'research', topic: topic.trim(), researchMode }
              : { type: 'file' };

      const form = new FormData();
      form.append('payload', JSON.stringify({ source, options }));
      if (mode === 'file' && file) form.append('file', file);

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

  async function saveToLibrary() {
    if (!result?.jobId) return;
    const filename = result.primary?.[0] ?? result.downloads?.[0]?.name;
    if (!filename) {
      toast('Nothing to save (no file produced)');
      return;
    }
    try {
      const r = await saveFromJob({
        jobId: result.jobId,
        filename,
        kind: t.backendKind ?? 'report',
        title: `${t.label} — ${filename.replace(/\.[^.]+$/, '')}`,
        origin: 'upload',
        collectionId,
      });
      setSaved(true);
      toast(
        r.embedSkipped
          ? 'Saved — not indexed for search (embedding failed; backfill in Settings → Diagnose)'
          : collectionId
            ? 'Saved to collection'
            : 'Saved to library',
      );
      onDone?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

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
            <small>From a new source, with AI</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Source */}
          <div className="field">
            <label>Source</label>
            <div className="seg">
              {(['url', 'text', 'file', 'research'] as const).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {m === 'url' ? 'URL' : m === 'text' ? 'Text' : m === 'file' ? 'File' : 'Research'}
                </button>
              ))}
            </div>
          </div>
          {mode === 'url' && (
            <div className="field">
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {mode === 'text' && (
            <div className="field">
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text to base the artifact on…" />
            </div>
          )}
          {mode === 'file' && (
            <div className="field">
              <button className="dropzone" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
                <Icon id="i-upload" />
                <div style={{ marginTop: 8 }}>{file ? file.name : 'Click to choose a file'}</div>
              </button>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
          {mode === 'research' && (
            <>
              <div className="field">
                <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Research topic…" />
              </div>
              <div className="field">
                <label>Research depth</label>
                <div className="seg" style={{ gridAutoColumns: '1fr' }}>
                  {(['fast', 'deep'] as const).map((m) => (
                    <button key={m} className={researchMode === m ? 'on' : ''} onClick={() => setResearchMode(m)}>
                      {m === 'fast' ? 'Fast' : 'Deep'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Options */}
          {spec.fields.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              {f.opts.length <= 3 ? (
                <div className="seg">
                  {f.opts.map((o) => (
                    <button key={o} className={opts[f.key] === o ? 'on' : ''} onClick={() => setOpts((p) => ({ ...p, [f.key]: o }))}>
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <select className="selectbox" value={opts[f.key]} onChange={(e) => setOpts((p) => ({ ...p, [f.key]: e.target.value }))}>
                  {f.opts.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          <div className="field">
            <label>Instructions (optional)</label>
            <textarea className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
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
              {result.downloads?.map((d) => (
                <a key={d.url} className="dl-row" href={d.url} download style={{ marginBottom: 6 }}>
                  <Icon id="i-download" />
                  {d.name}
                </a>
              ))}
              <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={saved} onClick={saveToLibrary}>
                <Icon id="i-check" /> {saved ? 'Saved to library' : 'Save to library'}
              </button>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || !canGenerate} onClick={run}>
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
