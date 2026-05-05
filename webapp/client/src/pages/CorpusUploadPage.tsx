import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  ingestToCorpus,
  type ArtifactKind,
  type IngestResult,
} from '../lib/corpus';

/**
 * /corpus/upload — manual ingestion for documents that didn't come from
 * NotebookLM (PDF, DOCX, HTML, MD, plain text, CSV/JSON, etc.).
 *
 * Flow:
 *   pick file → auto-fill title from filename → choose kind + tags → submit
 *   → server uploads to Object Storage, extracts text, embeds, inserts.
 *
 * On success we show the new artifact's ULID + chunk count and link to
 * the search page so the user can verify the ingest worked.
 */

const KIND_LABELS: Record<ArtifactKind, string> = {
  audio: 'Audio',
  report: 'Report',
  video: 'Video',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  infographic: 'Infographic',
  slides: 'Slides',
  data_table: 'Data table',
  upload: 'Upload (generic)',
  qa: 'Q&A',
};

function defaultTitleFromName(filename: string): string {
  // Strip extension; replace underscores/dashes with spaces; trim.
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function CorpusUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ArtifactKind>('upload');
  const [tagsInput, setTagsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(
    () =>
      tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 32),
    [tagsInput],
  );

  function selectFile(f: File | null) {
    setFile(f);
    setResult(null);
    setError(null);
    if (f && !title) setTitle(defaultTitleFromName(f.name));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) selectFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await ingestToCorpus({
        file,
        title: trimmedTitle,
        kind,
        origin: 'upload',
        tags,
      });
      setResult(r);
      // Clear the form for the next upload, but keep tags (usually reused).
      setFile(null);
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload to corpus</h1>
        <p className="text-sm text-slate-600">
          Ingest any document into your research corpus. Supported:{' '}
          <strong>PDF, DOCX, HTML, MD, TXT, CSV, JSON</strong>. Text is
          extracted, chunked, embedded, and indexed for semantic search.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-8 text-center transition ${
            dragActive
              ? 'border-brand-500 bg-brand-50'
              : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
            accept=".pdf,.docx,.html,.htm,.md,.txt,.csv,.json"
          />
          {file ? (
            <>
              <div className="text-sm font-medium text-slate-800">{file.name}</div>
              <div className="text-xs text-slate-500">
                {formatBytes(file.size)} · {file.type || 'unknown'}
              </div>
              <button
                type="button"
                className="btn-ghost mt-1 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  selectFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
              >
                Clear
              </button>
            </>
          ) : (
            <>
              <div className="text-sm text-slate-600">
                Drag &amp; drop a file here, or click to browse
              </div>
              <div className="text-xs text-slate-400">
                Max 100 MB · text extraction runs server-side
              </div>
            </>
          )}
        </div>

        <div>
          <label className="label" htmlFor="up-title">
            Title
          </label>
          <input
            id="up-title"
            type="text"
            className="input"
            placeholder="e.g. Q2 2024 earnings walkthrough"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={512}
            disabled={busy}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="up-kind">
              Kind
            </label>
            <select
              id="up-kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as ArtifactKind)}
              disabled={busy}
            >
              {ARTIFACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Use <code>upload</code> for generic documents; other kinds mirror
              NotebookLM artifact types.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="up-tags">
              Tags <span className="text-slate-400">(comma-separated)</span>
            </label>
            <input
              id="up-tags"
              type="text"
              className="input"
              placeholder="q2-earnings, tencent, research"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              disabled={busy}
            />
            {tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t} className="badge">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
          <button type="submit" className="btn-primary" disabled={busy || !file}>
            {busy ? 'Uploading…' : 'Ingest'}
          </button>
          {busy && (
            <span className="text-xs text-slate-500">
              Uploading → extracting → embedding → inserting…
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="card border-rose-300 bg-rose-50 text-sm text-rose-900">
          {error}
        </div>
      )}

      {result && (
        <div className="card border-emerald-300 bg-emerald-50 space-y-2">
          <div className="flex items-center gap-2">
            <span className="badge bg-emerald-100 text-emerald-800">Ingested ✓</span>
            <span className="text-sm text-emerald-900">
              {result.chunkCount} chunk{result.chunkCount === 1 ? '' : 's'} ·{' '}
              {formatBytes(result.sizeBytes)}
            </span>
          </div>
          <div className="font-mono text-[11px] text-slate-600">
            id <code>{result.id}</code> · object <code>{result.objectName}</code>
          </div>
          {result.textPreview && (
            <div className="rounded-md bg-white p-2 text-xs text-slate-700">
              <span className="text-slate-400">preview: </span>
              {result.textPreview.slice(0, 240)}
              {result.textPreview.length >= 240 ? '…' : ''}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Link to="/corpus" className="btn-secondary text-xs">
              Go to search
            </Link>
            <Link to="/corpus/library" className="btn-ghost text-xs">
              Browse library
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
