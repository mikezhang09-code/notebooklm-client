import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFormData, apiGet, apiJson } from '../lib/api';

interface SourceInfo {
  id: string;
  title: string;
  wordCount?: number;
  url?: string;
}

interface ArtifactInfo {
  id: string;
  title: string;
  type: number;
  typeLabel: string;
  durationSeconds?: number;
}

interface DetailResponse {
  title: string;
  sources: SourceInfo[];
  artifacts?: ArtifactInfo[];
}

type CorpusAutoIngestStatus =
  | 'scheduled'
  | 'disabled'
  | 'skipped_kind'
  | 'no_file';

interface DownloadResponse {
  jobId: string;
  type: number;
  typeLabel: string;
  files: Array<{ name: string; url: string }>;
  streamUrl?: string;
  corpus?: { status: CorpusAutoIngestStatus };
}

const MIND_MAP_TYPE = 5;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m${s > 0 ? `${s}s` : ''}` : `${s}s`;
}

/** Trigger an actual file download via a transient anchor element. */
function triggerBrowserDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function NotebookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-source form state.
  const [addMode, setAddMode] = useState<'url' | 'text' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  // Per-artifact download state, keyed by artifact id.
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [downloadResult, setDownloadResult] = useState<Record<string, DownloadResponse>>({});
  const [downloadError, setDownloadError] = useState<Record<string, string>>({});

  async function handleDownload(artifactId: string) {
    if (!id) return;
    setDownloading((d) => ({ ...d, [artifactId]: true }));
    setDownloadError((d) => {
      const next = { ...d };
      delete next[artifactId];
      return next;
    });
    try {
      // Pass titles so the corpus entry gets a human-readable name
      // (notebook title + artifact title) rather than a filename-derived one.
      const artifact = detail?.artifacts?.find((x) => x.id === artifactId);
      const result = await apiJson<DownloadResponse>(
        `/api/notebooks/${id}/artifacts/${artifactId}/download`,
        {
          notebookTitle: detail?.title,
          artifactTitle: artifact?.title,
        },
      );
      setDownloadResult((d) => ({ ...d, [artifactId]: result }));
      // Auto-trigger the first file download for one-click feel.
      if (result.files.length > 0) {
        triggerBrowserDownload(result.files[0].url, result.files[0].name);
      }
    } catch (err) {
      setDownloadError((d) => ({
        ...d,
        [artifactId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setDownloading((d) => {
        const next = { ...d };
        delete next[artifactId];
        return next;
      });
    }
  }

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<DetailResponse>(`/api/notebooks/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [id]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const form = new FormData();
      if (addMode === 'url') form.append('url', url);
      else if (addMode === 'text') {
        form.append('text', text);
        if (title) form.append('title', title);
      } else if (file) form.append('file', file);
      const res = await apiFormData<{ sourceId: string; title: string }>(
        `/api/notebooks/${id}/sources`,
        form,
      );
      setAddMsg(`Added: ${res.title}`);
      setUrl('');
      setText('');
      setTitle('');
      setFile(null);
      await reload();
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  if (!id) return <div>Invalid notebook id</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/library" className="btn-ghost">
          ← Library
        </Link>
        <h1 className="truncate text-2xl font-bold text-slate-900">
          {detail?.title ?? (loading ? 'Loading…' : '(notebook)')}
        </h1>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Sources ({detail?.sources.length ?? 0})</h2>
        <ul className="divide-y divide-slate-200">
          {detail?.sources.map((s) => (
            <li key={s.id} className="py-2">
              <div className="font-medium text-slate-900">{s.title}</div>
              <div className="text-xs text-slate-500">
                <code className="font-mono">{s.id}</code>
                {s.wordCount !== undefined && <span className="ml-2">{s.wordCount} words</span>}
                {s.url && (
                  <a
                    href={s.url}
                    className="ml-2 text-brand-600 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.url}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAdd} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <div className="font-medium">Add source</div>
          <div className="flex flex-wrap gap-2">
            {(['url', 'text', 'file'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${
                  addMode === m
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 text-slate-600'
                }`}
                onClick={() => setAddMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {addMode === 'url' && (
            <input
              className="input"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          )}
          {addMode === 'text' && (
            <div className="space-y-2">
              <input
                className="input"
                type="text"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="input h-28"
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
              />
            </div>
          )}
          {addMode === 'file' && (
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          )}
          <div className="flex items-center gap-2">
            <button type="submit" className="btn-primary" disabled={adding}>
              {adding ? 'Adding…' : 'Add source'}
            </button>
            {addMsg && <span className="text-sm text-slate-600">{addMsg}</span>}
          </div>
        </form>
      </div>

      {detail?.artifacts && detail.artifacts.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-lg font-semibold">Studio ({detail.artifacts.length})</h2>
          <ul className="divide-y divide-slate-200">
            {detail.artifacts.map((a) => {
              const isMindMap = a.type === MIND_MAP_TYPE;
              const isBusy = !!downloading[a.id];
              const dlResult = downloadResult[a.id];
              const dlError = downloadError[a.id];
              return (
                <li key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge-brand">{a.typeLabel}</span>
                    <span className="font-medium text-slate-900">{a.title}</span>
                    {a.durationSeconds !== undefined && (
                      <span className="text-xs text-slate-500">
                        {formatDuration(a.durationSeconds)}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {isMindMap ? (
                        <a
                          href={`https://notebooklm.google.com/notebook/${id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-brand-600 hover:underline"
                        >
                          Open in NotebookLM ↗
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={isBusy}
                          onClick={() => void handleDownload(a.id)}
                        >
                          {isBusy ? 'Downloading…' : 'Download'}
                        </button>
                      )}
                    </span>
                  </div>
                  <code className="font-mono text-[11px] text-slate-400">{a.id}</code>
                  {dlError && (
                    <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                      {dlError}
                    </div>
                  )}
                  {dlResult?.corpus && (
                    <CorpusBadge status={dlResult.corpus.status} />
                  )}
                  {dlResult && (dlResult.files.length > 1 || dlResult.streamUrl) && (
                    <div className="mt-2 space-y-1 text-sm">
                      {dlResult.files.map((f) => (
                        <div key={f.url}>
                          <a href={f.url} download={f.name} className="text-brand-600 hover:underline">
                            ⬇ {f.name}
                          </a>
                        </div>
                      ))}
                      {dlResult.streamUrl && (
                        <div>
                          <a
                            href={dlResult.streamUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-600 hover:underline"
                          >
                            Open stream ↗
                          </a>
                          <span className="ml-2 text-xs text-slate-500">
                            (no direct download for this video)
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function CorpusBadge({ status }: { status: CorpusAutoIngestStatus }): JSX.Element | null {
  // Small signal to the user that the download was (or wasn't) indexed
  // in the research corpus. The actual embed completes async on the
  // server; 'scheduled' means the server accepted the job, not that
  // it has already finished.
  switch (status) {
    case 'scheduled':
      return (
        <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
          <span aria-hidden>✓</span> Saved to research corpus
        </span>
      );
    case 'disabled':
      return null;
    case 'skipped_kind':
      return (
        <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          Not indexed (mind-map / non-file artifact)
        </span>
      );
    case 'no_file':
      return (
        <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          Not indexed (no downloadable file)
        </span>
      );
    default:
      return null;
  }
}
