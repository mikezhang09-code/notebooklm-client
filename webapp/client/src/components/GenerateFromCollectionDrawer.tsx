/**
 * Generate an artifact *from a collection's own files*.
 *
 * In a collection the context is already there, so this never asks for a new
 * source — the collection's files are the input. Engines:
 *   • Quiz / Flashcards / Mind map can use EITHER engine (toggle):
 *       – "From collection (AI)" — POST /api/corpus/collections/:id/generate:
 *         our GenAI reads the selected files' text and returns the artifact
 *         JSON, ingested straight into the collection (fast, no NotebookLM).
 *       – "Via NotebookLM" — POST /api/generate/:kind with a `collection`
 *         source (files folded into one NotebookLM text source).
 *   • All other types (audio, report, video, infographic, slides, data table)
 *     can only be produced by NotebookLM, so there's no toggle — just the
 *     NotebookLM path, still grounded in the collection's files.
 *
 * Eligible (text-bearing) files are checked by default; derived/media items are
 * listed but unchecked.
 */
import { useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { streamSse, apiJson, apiDelete } from '../lib/api';
import { saveFromJob } from '../lib/artifacts';
import {
  GEN_SPEC,
  LANGS,
  LANG_CODE,
  describe,
  TYPE,
  toBackendValue,
  type TypeKey,
} from '../lib/registry';
import type { CollectionFile } from '../lib/collections';
import { toast } from '../lib/toast';

type Engine = 'ai' | 'notebooklm';
type LogLine = { kind: 'info' | 'prog' | 'done' | 'error'; text: string; ts: string };
interface ResultData {
  jobId?: string;
  downloads?: { name: string; url: string }[];
  primary?: string[];
  meta?: Record<string, unknown>;
}

/** Pull the notebook id out of a `…/notebook/<id>` URL. */
function notebookIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return url.split('/notebook/')[1]?.split(/[/?#]/)[0] ?? null;
}

// Kinds that carry source text worth grounding generation in. Derived artifacts
// and media are excluded from the default selection (but still selectable).
const NON_TEXT_KINDS = new Set([
  'audio',
  'video',
  'quiz',
  'flashcards',
  'mind',
  'diagram',
  'infographic',
  'slides',
]);

function isTextBearing(f: CollectionFile): boolean {
  if (NON_TEXT_KINDS.has(f.kind)) return false;
  const m = (f.mimeType ?? '').toLowerCase();
  if (m.startsWith('image/') || m.startsWith('audio/') || m.startsWith('video/')) return false;
  return true;
}

export default function GenerateFromCollectionDrawer({
  typeKey,
  collectionId,
  files,
  onClose,
  onDone,
}: {
  typeKey: TypeKey;
  collectionId: string;
  files: CollectionFile[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = TYPE[typeKey];
  const spec = GEN_SPEC[typeKey];
  // Quiz / flashcards / mind maps are the only types our own AI can emit as
  // JSON; everything else must go through NotebookLM.
  const aiCapable = typeKey === 'quiz' || typeKey === 'flash' || typeKey === 'mind';
  const aiKind = (t.backendKind ?? 'quiz') as 'quiz' | 'flashcards' | 'mind';
  const isItemy = typeKey === 'quiz' || typeKey === 'flash';

  const defaults = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of spec.fields) o[f.key] = f.opts[0] ?? '';
    return o;
  }, [spec]);

  const [engine, setEngine] = useState<Engine>(aiCapable ? 'ai' : 'notebooklm');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(files.filter(isTextBearing).map((f) => f.id)),
  );
  const [opts, setOpts] = useState<Record<string, string>>(defaults);
  const [difficulty, setDifficulty] = useState('Medium');
  const [count, setCount] = useState(typeKey === 'quiz' ? 8 : 12);
  const [lang, setLang] = useState('English');
  const [instructions, setInstructions] = useState('');
  // The NotebookLM path spins up a throwaway notebook; clean it up once the
  // result is safely saved into the collection (default on).
  const [cleanup, setCleanup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const eligibleCount = useMemo(() => files.filter(isTextBearing).length, [files]);

  function addLog(k: LogLine['kind'], text: string) {
    setLog((l) => [...l, { kind: k, text, ts: new Date().toLocaleTimeString() }]);
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
  const canGenerate = fileIds.length > 0 && !busy;

  async function runAi() {
    const r = await apiJson<{ id: string; title: string }>(
      `/api/corpus/collections/${collectionId}/generate`,
      {
        kind: aiKind,
        fileIds,
        ...(isItemy ? { difficulty, count } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      },
    );
    toast(`Saved “${r.title}” to collection`);
    setSaved(true);
    onDone?.();
  }

  async function runNotebookLm() {
    const options: Record<string, string> = {};
    for (const f of spec.fields) if (opts[f.key]) options[f.key] = toBackendValue(opts[f.key]);
    if (instructions.trim()) options.instructions = instructions.trim();
    if (spec.language) options.language = LANG_CODE[lang] ?? 'en';

    const form = new FormData();
    form.append(
      'payload',
      JSON.stringify({ source: { type: 'collection', collectionId, fileIds }, options }),
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
        },
        onError: (m) => addLog('error', m),
      },
      controller.signal,
    );
  }

  async function run() {
    setBusy(true);
    setLog([]);
    setResult(null);
    setSaved(false);
    try {
      if (engine === 'ai') await runAi();
      else await runNotebookLm();
    } catch (err) {
      addLog('error', err instanceof Error ? err.message : String(err));
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  // NotebookLM produces a job file that still needs saving into the collection.
  async function saveToCollection() {
    if (!result?.jobId) return;
    const filename = result.primary?.[0] ?? result.downloads?.[0]?.name;
    if (!filename) {
      toast('Nothing to save (no file produced)');
      return;
    }
    try {
      await saveFromJob({
        jobId: result.jobId,
        filename,
        kind: t.backendKind ?? 'report',
        title: `${t.label} — ${filename.replace(/\.[^.]+$/, '')}`,
        origin: 'upload',
        collectionId,
      });
      setSaved(true);
      toast('Saved to collection');
      // Only now that the artifact is safely in the collection do we remove the
      // throwaway NotebookLM notebook. Best-effort — a cleanup failure must not
      // undo or mask the successful save.
      const nbId = notebookIdFromUrl(result.meta?.notebookUrl);
      if (cleanup && nbId) {
        try {
          await apiDelete(`/api/notebooks/${nbId}`);
          addLog('info', 'Removed the temporary NotebookLM notebook.');
        } catch (err) {
          addLog('error', `Saved, but couldn't remove the temporary notebook: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      onDone?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

  const showSpecFields = engine === 'notebooklm';

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
            <small>From this collection’s files</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Engine — only quiz/flash/mind can use the fast in-app AI path */}
          {aiCapable && (
            <div className="field">
              <label>Engine</label>
              <div className="seg" style={{ gridAutoColumns: '1fr' }}>
                <button className={engine === 'ai' ? 'on' : ''} onClick={() => setEngine('ai')}>
                  From collection (AI)
                </button>
                <button className={engine === 'notebooklm' ? 'on' : ''} onClick={() => setEngine('notebooklm')}>
                  Via NotebookLM
                </button>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                {engine === 'ai'
                  ? 'Fast — our AI reads the selected files and builds it directly.'
                  : 'Higher-fidelity — sends the files through NotebookLM (slower).'}
              </p>
            </div>
          )}
          {!aiCapable && (
            <p className="hint">
              {t.plural} are generated by NotebookLM from the files you select below.
            </p>
          )}

          {/* File selection */}
          <div className="field">
            <label>
              Context files · {selected.size}/{files.length} selected
            </label>
            {files.length === 0 ? (
              <p className="hint">This collection has no files yet.</p>
            ) : (
              <div
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  maxHeight: 220,
                  overflowY: 'auto',
                  background: 'var(--card-2)',
                }}
              >
                {files.map((f) => {
                  const face = describe(f.kind, f.mimeType, f.title);
                  const on = selected.has(f.id);
                  const eligible = isTextBearing(f);
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
                      }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(f.id)} style={{ width: 16, height: 16 }} />
                      <span style={{ color: face.color, display: 'inline-flex' }}>
                        <Icon id={face.icon} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {face.label}
                        {!eligible ? ' · derived' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {eligibleCount < files.length && (
              <p className="hint" style={{ marginTop: 6 }}>
                Media and previously-generated items are unchecked by default — tick them only if useful.
              </p>
            )}
          </div>

          {/* Options — AI path (quiz/flash) */}
          {engine === 'ai' && isItemy && (
            <>
              <div className="field">
                <label>Difficulty</label>
                <div className="seg">
                  {['Easy', 'Medium', 'Hard'].map((d) => (
                    <button key={d} className={difficulty === d ? 'on' : ''} onClick={() => setDifficulty(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>{typeKey === 'quiz' ? 'Number of questions' : 'Number of cards'}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={40}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                />
              </div>
            </>
          )}

          {/* Options — NotebookLM path (per-type spec fields + language) */}
          {showSpecFields &&
            spec.fields.map((f) => (
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
          {showSpecFields && spec.language && (
            <div className="field">
              <label>Language</label>
              <select className="selectbox" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Instructions (optional)</label>
            <textarea
              className="input"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. focus on key definitions"
            />
          </div>

          {engine === 'notebooklm' && (
            <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span>
                Delete the temporary NotebookLM notebook after saving
                <span className="hint" style={{ display: 'block' }}>
                  Uncheck to keep it in NotebookLM so you can open or refine it there.
                </span>
              </span>
            </label>
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

          {result && !saved && (
            <div className="result">
              <h4>Output</h4>
              {result.downloads?.map((d) => (
                <a key={d.url} className="dl-row" href={d.url} download style={{ marginBottom: 6 }}>
                  <Icon id="i-download" />
                  {d.name}
                </a>
              ))}
              <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={saveToCollection}>
                <Icon id="i-check" /> Save to collection
              </button>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={!canGenerate} onClick={run}>
            {busy ? <span className="spinner" /> : <Icon id={t.icon} />}
            {busy ? 'Generating…' : saved ? 'Generate again' : `Generate ${t.label}`}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            {saved ? 'Done' : 'Cancel'}
          </button>
        </div>
      </aside>
    </>
  );
}
