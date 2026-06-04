import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SourceInput, { buildSourcePayload, emptySource, type SourceState } from '../components/SourceInput';
import ProgressLog, { type ProgressEntry } from '../components/ProgressLog';
import { streamSse } from '../lib/api';
import { saveJobArtifact } from '../lib/corpus';
import { SPECS, type Kind } from '../lib/generate-specs';

interface ResultData {
  jobId?: string;
  downloads?: { name: string; url: string }[];
  primary?: string[];
  meta?: Record<string, unknown>;
}

export default function GeneratePage() {
  const params = useParams<{ kind: Kind }>();
  const kind = (params.kind ?? 'audio') as Kind;
  const spec = SPECS[kind];
  const defaults = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of spec.fields) if ('defaultValue' in f && f.defaultValue) out[f.name] = f.defaultValue;
    return out;
  }, [spec]);

  const [source, setSource] = useState<SourceState>(emptySource);
  const [opts, setOpts] = useState<Record<string, string>>(defaults);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const [saveStates, setSaveStates] = useState<Record<string, 'saving' | 'saved' | string>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Reset when kind changes.
  const lastKind = useRef(kind);
  if (lastKind.current !== kind) {
    lastKind.current = kind;
    setOpts(defaults);
    setSource(emptySource);
    setEntries([]);
    setResult(null);
  }

  function addEntry(kind: ProgressEntry['kind'], text: string) {
    setEntries((list) => [...list, { kind, text, ts: Date.now() }]);
  }

  function setOpt(name: string, value: string) {
    setOpts((o) => ({ ...o, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setEntries([]);
    setResult(null);
    setSaveStates({});
    try {
      const { payload, file } = buildSourcePayload(source);
      // Drop empty strings so the server sees them as undefined.
      const cleanedOpts: Record<string, string> = {};
      for (const [k, v] of Object.entries(opts)) {
        if (v !== '') cleanedOpts[k] = v;
      }
      const form = new FormData();
      form.append(
        'payload',
        JSON.stringify({ source: payload, options: cleanedOpts }),
      );
      if (file) form.append('file', file);

      const controller = new AbortController();
      abortRef.current = controller;
      addEntry('info', 'Request sent; streaming progress…');
      await streamSse(`/api/generate/${kind}`, form, {
        onProgress: (p) => addEntry('progress', `[${p.status}] ${p.message}`),
        onResult: (data) => {
          const r = data as ResultData;
          setResult(r);
          addEntry('result', 'Completed.');
        },
        onError: (msg) => addEntry('error', msg),
      }, controller.signal);
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

  async function handleSave(d: { name: string; url: string }) {
    if (!result?.jobId) return;
    setSaveStates((s) => ({ ...s, [d.name]: 'saving' }));
    try {
      await saveJobArtifact({
        jobId: result.jobId,
        filename: d.name,
        kind,
        title: `${spec.title} — ${d.name.replace(/\.[^.]+$/, '')}`,
      });
      setSaveStates((s) => ({ ...s, [d.name]: 'saved' }));
    } catch (err) {
      setSaveStates((s) => ({
        ...s,
        [d.name]: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{spec.title}</h1>
        <p className="text-sm text-slate-600">{spec.description}</p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <SourceInput value={source} onChange={setSource} disabled={busy} />

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

        <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
          {busy && (
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <ProgressLog entries={entries} />

      {result && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Output</h2>
          {result.downloads && result.downloads.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Downloads</div>
              <ul className="space-y-1">
                {result.downloads.map((d) => (
                  <li key={d.name} className="flex items-center gap-3">
                    <a href={d.url} className="text-brand-600 underline" download>
                      {d.name}
                    </a>
                    {saveStates[d.name] === 'saved' ? (
                      <span className="text-xs text-emerald-600">Saved ✓</span>
                    ) : saveStates[d.name] === 'saving' ? (
                      <span className="text-xs text-slate-500">Saving…</span>
                    ) : saveStates[d.name] ? (
                      <span className="text-xs text-rose-600" title={saveStates[d.name]}>
                        Save failed
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                        onClick={() => void handleSave(d)}
                      >
                        Save to library
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.meta && Object.keys(result.meta).length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Metadata</div>
              <pre className="max-h-60 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
                {JSON.stringify(result.meta, null, 2)}
              </pre>
            </div>
          )}
          {result.meta && typeof result.meta['notebookUrl'] === 'string' && (
            <a
              href={result.meta['notebookUrl']}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              Open notebook in NotebookLM ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
