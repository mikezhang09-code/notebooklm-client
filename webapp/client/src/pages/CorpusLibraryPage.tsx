import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  getArtifact,
  listArtifacts,
  type ArtifactDetail,
  type ArtifactListItem,
  type ArtifactListResponse,
  type ArtifactKind,
} from '../lib/corpus';

/**
 * /corpus/library — paginated, filterable table of every ingested artifact.
 *
 * Columns: title, kind, origin, size, chunks, created.
 * Row click → right-side detail drawer with PAR download URL.
 * Filters: kind (select), origin (select), title substring (client-side).
 */

const KIND_LABELS: Record<string, string> = {
  audio: 'Audio',
  report: 'Report',
  video: 'Video',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  infographic: 'Infographic',
  slides: 'Slides',
  data_table: 'Data table',
  upload: 'Upload',
};

const PAGE_SIZE = 25;

function formatBytes(n: number): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? (p as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function CorpusLibraryPage() {
  const [kind, setKind] = useState<ArtifactKind | ''>('');
  const [origin, setOrigin] = useState<'' | 'notebooklm' | 'upload'>('');
  const [titleFilter, setTitleFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<ArtifactListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listArtifacts({
        kind: kind || undefined,
        origin: origin || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [kind, origin, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset pagination when filters change.
  useEffect(() => {
    setOffset(0);
  }, [kind, origin]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const needle = titleFilter.trim().toLowerCase();
    if (!needle) return data.items;
    return data.items.filter((a) => a.TITLE.toLowerCase().includes(needle));
  }, [data, titleFilter]);

  async function handleSelect(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailBusy(true);
    try {
      const d = await getArtifact(id);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailBusy(false);
    }
  }

  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Corpus library</h1>
            <p className="text-sm text-slate-600">
              Every artifact you've ingested. {total.toLocaleString()} total.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/corpus/upload" className="btn-primary text-sm">
              Upload
            </Link>
            <Link to="/corpus" className="btn-secondary text-sm">
              Search
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="card grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="lib-kind">
              Kind
            </label>
            <select
              id="lib-kind"
              className="input"
              value={kind}
              onChange={(e) => setKind((e.target.value as ArtifactKind) || '')}
            >
              <option value="">All</option>
              {ARTIFACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lib-origin">
              Origin
            </label>
            <select
              id="lib-origin"
              className="input"
              value={origin}
              onChange={(e) =>
                setOrigin((e.target.value as '' | 'notebooklm' | 'upload') || '')
              }
            >
              <option value="">All</option>
              <option value="notebooklm">NotebookLM</option>
              <option value="upload">Upload</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lib-title">
              Title contains
            </label>
            <input
              id="lib-title"
              type="text"
              className="input"
              placeholder="client-side filter…"
              value={titleFilter}
              onChange={(e) => setTitleFilter(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          {loading && !data ? (
            <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
          ) : error ? (
            <div className="border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              {error}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No artifacts match these filters.{' '}
              <Link to="/corpus/upload" className="text-brand-600 hover:underline">
                Upload one?
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Origin</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">Chunks</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((a: ArtifactListItem) => {
                    const tagList = parseTags(a.TAGS);
                    const isSelected = a.ID === selectedId;
                    return (
                      <tr
                        key={a.ID}
                        onClick={() => void handleSelect(a.ID)}
                        className={`cursor-pointer transition hover:bg-slate-50 ${
                          isSelected ? 'bg-brand-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">
                            {a.TITLE}
                          </div>
                          {tagList.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {tagList.slice(0, 4).map((t) => (
                                <span key={t} className="badge">
                                  #{t}
                                </span>
                              ))}
                              {tagList.length > 4 && (
                                <span className="badge">
                                  +{tagList.length - 4}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="badge-brand">
                            {KIND_LABELS[a.KIND] ?? a.KIND}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{a.ORIGIN}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                          {formatBytes(a.SIZE_BYTES)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                          {a.CHUNK_COUNT}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {formatDate(a.CREATED_AT)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {data && total > 0 && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <div>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{' '}
              {total}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!hasPrev || loading}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!hasNext || loading}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right rail: detail */}
      <aside className="space-y-3">
        {selectedId ? (
          <DetailPanel
            detail={detail}
            busy={detailBusy}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
          />
        ) : (
          <div className="card text-sm text-slate-600">
            Click a row to see its metadata and get a 1-hour download link.
          </div>
        )}
      </aside>
    </div>
  );
}

function DetailPanel({
  detail,
  busy,
  onClose,
}: {
  detail: ArtifactDetail | null;
  busy: boolean;
  onClose: () => void;
}): JSX.Element {
  const a = (detail?.artifact ?? {}) as Record<string, unknown>;
  const get = (...keys: string[]): unknown => {
    for (const k of keys) if (a[k] != null) return a[k];
    return undefined;
  };
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Artifact
          </div>
          <div className="truncate font-mono text-xs text-slate-600">
            {String(get('ID', 'id') ?? '')}
          </div>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          Close ✕
        </button>
      </div>

      {busy && <div className="text-sm text-slate-500">Loading…</div>}

      {detail && (
        <>
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {(
              [
                ['Title', get('TITLE', 'title')],
                ['Kind', get('KIND', 'kind')],
                ['Origin', get('ORIGIN', 'origin')],
                ['MIME', get('MIME_TYPE', 'mimeType') ?? '—'],
                [
                  'Size',
                  typeof get('SIZE_BYTES', 'sizeBytes') === 'number'
                    ? formatBytes(get('SIZE_BYTES', 'sizeBytes') as number)
                    : '—',
                ],
                ['Bucket', get('BUCKET', 'bucket')],
                ['Object', get('OBJECT_NAME', 'objectName')],
                [
                  'Created',
                  typeof get('CREATED_AT', 'createdAt') === 'string'
                    ? formatDate(get('CREATED_AT', 'createdAt') as string)
                    : '—',
                ],
              ] as Array<[string, unknown]>
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-slate-500">{label}</dt>
                <dd
                  className="truncate text-slate-800"
                  title={String(value ?? '')}
                >
                  {String(value ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-200 pt-3">
            <a
              href={detail.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full"
            >
              Download blob ↗
            </a>
            <p className="mt-1 text-[11px] text-slate-500">
              PAR valid until {formatDate(detail.expiresAt)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
