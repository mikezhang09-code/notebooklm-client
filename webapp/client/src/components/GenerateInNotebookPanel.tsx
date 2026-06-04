import { useMemo, useRef, useState } from 'react';
import ProgressLog, { type ProgressEntry } from './ProgressLog';
import { streamSse } from '../lib/api';
import { SPECS, type Kind } from '../lib/generate-specs';

const KIND_ORDER: Kind[] = [
  'audio',
  'report',
  'video',
  'quiz',
  'flashcards',
  'infographic',
  'slides',
  'data-table',
];

interface SourceLite {
  id: string;
  title: string;
}

interface ResultData {
  jobId?: string;
  downloads?: { name: string; url: string }[];
  primary?: string[];
  meta?: Record<string, unknown>;
}

/**
 * Generate a new artifact from an existing notebook's sources — the in-place
 * counterpart to the standalone Generate page (which always creates a fresh
 * notebook). Streams progress over SSE and lists download links on completion.
 */
export default function GenerateInNotebookPanel({
  notebookId,
  sources,
  onGenerated,
}: {
  notebookId: string;
  sources: SourceLite[];
  onGenerated?: () => void;
}) {
  const [kind, setKind] = useState<Kind>('audio');
  const spec = SPECS[kind];

  const defaults = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of spec.fields) if ('defaultValue' in f && f.defaultValue) out[f.name] = f.defaultValue;
    return out;
  }, [spec]);

  const [opts, setOpts] = useState<Record<string, string>>(defaults);
  // Which sources to feed the generator. Empty selection = use all sources.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset option fields whenever the artifact kind changes.
  const lastKind = useRef(kind);
  if (lastKind.current !== kind) {
    lastKind.current = kind;
    setOpts(defaults);
    setEntries([]);
    setResult(null);
  }

  function addEntry(k: ProgressEntry['kind'], text: string) {
    setEntries((list) => [...list, { kind: k, text, ts: Date.now() }]);
  }

  function setOpt(name: string, value: string) {
    setOpts((o) => ({ ...o, [name]: value }));
  }

  function toggleSource(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setEntries([]);
    setResult(null);
    try {
      const cleanedOpts: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts)) {
        if (v !== '') cleanedOpts[k] = v;
      }
      // Omit sourceIds when nothing is checked → server uses all sources.
      const sourceIds = selected.size > 0 ? [...selected] : undefined;
      const form = new FormData();
      form.append(
        'payload',
        JSON.stringify({ notebookId, sourceIds, options: cleanedOpts }),
      );

      const controller = new AbortController();
      abortRef.current = controller;
      addEntry('info', 'Request sent; streaming progress…');
      await streamSse(
        `/api/generate/${kind}`,
        form,
        {
          onProgress: (p) => addEntry('progress', `[${p.status}] ${p.message}`),
          onResult: (data) => {
            setResult(data as ResultData);
            addEntry('result', 'Completed.');
            onGenerated?.();
          },
          onError: (msg) => addEntry('error', msg),
        },
        controller.signal,
      );
    } catch (err) {
      addEntry('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    addEntry('info', 'Cancelled.');
  }

  const noSources = sources.length === 0;

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Generate from these sources</h2>
        <p className="text-sm text-slate-600">
          Create a new artifact in this notebook without re-uploading anything.
        </p>
      </div>

      {noSources ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Add at least one source above before generating.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Artifact type</label>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              disabled={busy}
            >
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {SPECS[k].title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{spec.description}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {spec.fields.map((f) => (
              <div key={f.name} className={f.kind === 'textarea' ? 'md:col-span-2' : ''}>
                <label className="label">{f.label}</label>
                {f.kind === 'select' && (
                  <select
                    className="input"
                    value={opts[f.name] ?? ''}
                    onChange={(e) => setOpt(f.name, e.target.value)}
                    disabled={busy}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {f.kind === 'text' && (
                  <input
                    className="input"
                    type="text"
                    placeholder={f.placeholder}
                    value={opts[f.name] ?? ''}
                    onChange={(e) => setOpt(f.name, e.target.value)}
                    disabled={busy}
                  />
                )}
                {f.kind === 'textarea' && (
                  <textarea
                    className="input h-24"
                    placeholder={f.placeholder}
                    value={opts[f.name] ?? ''}
                    onChange={(e) => setOpt(f.name, e.target.value)}
                    disabled={busy}
                  />
                )}
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label mb-0">
                Sources{' '}
                <span className="font-normal text-slate-500">
                  ({selected.size === 0 ? 'all' : `${selected.size} selected`})
                </span>
              </label>
              {selected.size > 0 && (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                  onClick={() => setSelected(new Set())}
                  disabled={busy}
                >
                  Use all
                </button>
              )}
            </div>
            <ul className="mt-1 max-h-40 space-y-1 overflow-auto rounded-md border border-slate-200 p-2">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`gen-src-${s.id}`}
                    checked={selected.has(s.id)}
                    onChange={() => toggleSource(s.id)}
                    disabled={busy}
                  />
                  <label htmlFor={`gen-src-${s.id}`} className="truncate">
                    {s.title}
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Leave all unchecked to generate from every source.
            </p>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Generating…' : `Generate ${spec.title.toLowerCase()}`}
            </button>
            {busy && (
              <button type="button" className="btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {entries.length > 0 && <ProgressLog entries={entries} />}

      {result && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <div className="text-sm font-medium text-slate-700">Output</div>
          {result.downloads && result.downloads.length > 0 ? (
            <ul className="space-y-1">
              {result.downloads.map((d) => (
                <li key={d.name}>
                  <a href={d.url} className="text-brand-600 underline" download>
                    ⬇ {d.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No downloadable file (see metadata below).</p>
          )}
          {result.meta && typeof result.meta['streamUrl'] === 'string' && (
            <a
              href={result.meta['streamUrl']}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 underline"
            >
              Open stream ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
