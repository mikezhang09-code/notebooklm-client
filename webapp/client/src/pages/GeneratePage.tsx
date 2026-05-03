import { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SourceInput, { buildSourcePayload, emptySource, type SourceState } from '../components/SourceInput';
import ProgressLog, { type ProgressEntry } from '../components/ProgressLog';
import { streamSse } from '../lib/api';

type Kind =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flashcards'
  | 'infographic'
  | 'slides'
  | 'data-table';

interface KindSpec {
  title: string;
  description: string;
  fields: FieldSpec[];
}

type FieldSpec =
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }
  | { kind: 'text'; name: string; label: string; placeholder?: string; defaultValue?: string }
  | { kind: 'textarea'; name: string; label: string; placeholder?: string; defaultValue?: string };

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'hi', label: 'Hindi' },
];

const SPECS: Record<Kind, KindSpec> = {
  audio: {
    title: 'Audio podcast',
    description: 'Generate an audio overview from the source material.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'deep_dive', label: 'Deep dive' },
          { value: 'brief', label: 'Brief' },
          { value: 'critique', label: 'Critique' },
          { value: 'debate', label: 'Debate' },
        ],
      },
      {
        kind: 'select',
        name: 'length',
        label: 'Length',
        options: [
          { value: '', label: '(default)' },
          { value: 'short', label: 'Short' },
          { value: 'default', label: 'Default' },
          { value: 'long', label: 'Long' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  report: {
    title: 'Report',
    description: 'Generate a briefing doc, study guide, blog post, or custom report.',
    fields: [
      {
        kind: 'select',
        name: 'template',
        label: 'Template',
        options: [
          { value: 'briefing_doc', label: 'Briefing doc' },
          { value: 'study_guide', label: 'Study guide' },
          { value: 'blog_post', label: 'Blog post' },
          { value: 'custom', label: 'Custom' },
        ],
        defaultValue: 'briefing_doc',
      },
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  video: {
    title: 'Video overview',
    description: 'Generate a video overview with a chosen style.',
    fields: [
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'explainer', label: 'Explainer' },
          { value: 'brief', label: 'Brief' },
          { value: 'cinematic', label: 'Cinematic' },
        ],
      },
      {
        kind: 'select',
        name: 'style',
        label: 'Style',
        options: [
          { value: '', label: '(auto)' },
          { value: 'auto', label: 'Auto' },
          { value: 'classic', label: 'Classic' },
          { value: 'whiteboard', label: 'Whiteboard' },
          { value: 'kawaii', label: 'Kawaii' },
          { value: 'anime', label: 'Anime' },
          { value: 'watercolor', label: 'Watercolor' },
          { value: 'retro_print', label: 'Retro print' },
        ],
      },
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  quiz: {
    title: 'Quiz',
    description: 'Generate an interactive HTML quiz.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'quantity',
        label: 'Quantity',
        options: [
          { value: '', label: '(default)' },
          { value: 'fewer', label: 'Fewer' },
          { value: 'standard', label: 'Standard' },
        ],
      },
      {
        kind: 'select',
        name: 'difficulty',
        label: 'Difficulty',
        options: [
          { value: '', label: '(default)' },
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  flashcards: {
    title: 'Flashcards',
    description: 'Generate interactive flashcards.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'quantity',
        label: 'Quantity',
        options: [
          { value: '', label: '(default)' },
          { value: 'fewer', label: 'Fewer' },
          { value: 'standard', label: 'Standard' },
        ],
      },
      {
        kind: 'select',
        name: 'difficulty',
        label: 'Difficulty',
        options: [
          { value: '', label: '(default)' },
          { value: 'easy', label: 'Easy' },
          { value: 'medium', label: 'Medium' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  infographic: {
    title: 'Infographic',
    description: 'Generate a single-image infographic.',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'orientation',
        label: 'Orientation',
        options: [
          { value: '', label: '(default)' },
          { value: 'landscape', label: 'Landscape' },
          { value: 'portrait', label: 'Portrait' },
          { value: 'square', label: 'Square' },
        ],
      },
      {
        kind: 'select',
        name: 'detail',
        label: 'Detail',
        options: [
          { value: '', label: '(default)' },
          { value: 'concise', label: 'Concise' },
          { value: 'standard', label: 'Standard' },
          { value: 'detailed', label: 'Detailed' },
        ],
      },
      {
        kind: 'select',
        name: 'style',
        label: 'Style',
        options: [
          { value: '', label: '(default)' },
          { value: 'sketch_note', label: 'Sketch note' },
          { value: 'professional', label: 'Professional' },
          { value: 'bento_grid', label: 'Bento grid' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  slides: {
    title: 'Slide deck',
    description: 'Generate a slide deck (PPTX, with optional PDF).',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'select',
        name: 'format',
        label: 'Format',
        options: [
          { value: '', label: '(default)' },
          { value: 'detailed', label: 'Detailed' },
          { value: 'presenter', label: 'Presenter' },
        ],
      },
      {
        kind: 'select',
        name: 'length',
        label: 'Length',
        options: [
          { value: '', label: '(default)' },
          { value: 'default', label: 'Default' },
          { value: 'short', label: 'Short' },
        ],
      },
      { kind: 'textarea', name: 'instructions', label: 'Custom instructions (optional)' },
    ],
  },
  'data-table': {
    title: 'Data table',
    description: 'Extract a structured data table (CSV).',
    fields: [
      { kind: 'select', name: 'language', label: 'Language', options: LANG_OPTIONS, defaultValue: 'en' },
      {
        kind: 'textarea',
        name: 'instructions',
        label: 'Instructions',
        placeholder: 'Describe the table structure you want…',
      },
    ],
  },
};

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
                  <li key={d.name}>
                    <a href={d.url} className="text-brand-600 underline" download>
                      {d.name}
                    </a>
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
