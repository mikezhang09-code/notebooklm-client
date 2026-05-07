import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  transcribeArtifact,
  updateArtifact,
  viewArtifact,
  type ArtifactDetail,
  type ArtifactListItem,
  type ArtifactListResponse,
  type ArtifactKind,
  type TranscriptionStatus,
  type ViewResult,
} from '../lib/corpus';
import { ShareControls } from './CorpusPage';

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
  qa: 'Q&A',
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

const AUDIO_VIDEO_KINDS = new Set(['audio', 'video']);

/**
 * Compact inline badge for the transcript column. Non-audio/video rows
 * render an em-dash; `skipped` rows also dash. `pending` and
 * `transcribing` both render as a subtle spinner.
 */
function TranscriptionBadge({
  kind,
  status,
  error,
}: {
  kind: string;
  status: TranscriptionStatus | null | undefined;
  error: string | null | undefined;
}): JSX.Element {
  if (!AUDIO_VIDEO_KINDS.has(kind)) {
    return <span className="text-slate-300">—</span>;
  }
  if (!status || status === 'skipped') {
    return (
      <span
        className="text-slate-400"
        title={error ?? 'Not transcribed'}
      >
        —
      </span>
    );
  }
  if (status === 'pending' || status === 'transcribing') {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-700"
        title={status === 'pending' ? 'Queued' : 'Transcribing…'}
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        {status === 'pending' ? 'queued' : 'running'}
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span
        className="text-emerald-700"
        title="Transcript indexed"
        aria-label="Done"
      >
        ✓
      </span>
    );
  }
  // failed
  return (
    <span
      className="text-rose-700"
      title={error ?? 'Transcription failed'}
      aria-label="Failed"
    >
      ✗
    </span>
  );
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

  // Bulk-selection state for the table (independent of the detail-pane focus).
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Wrapped in useCallback so the auto-refresh effect below can list it as
  // a stable dep without resubscribing every render (which would clear
  // the interval before each tick).
  const refreshDetail = useCallback(
    async (id: string) => {
      setDetailBusy(true);
      try {
        const d = await getArtifact(id);
        setDetail(d);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Reset pagination when filters change.
  useEffect(() => {
    setOffset(0);
  }, [kind, origin]);

  // M7: auto-refresh while any visible row has a transcription in flight.
  // The poller on the server side ticks every 30s; we refresh every 15s so
  // we catch state changes quickly without hammering the API when idle.
  const hasActiveTranscriptions = useMemo(() => {
    if (!data) return false;
    return data.items.some(
      (a) =>
        a.TRANSCRIPTION_STATUS === 'pending' ||
        a.TRANSCRIPTION_STATUS === 'transcribing',
    );
  }, [data]);

  // While anything is in flight, tick both the list AND the open detail
  // drawer (if any). Without the second call, a user staring at the
  // drawer of a transcribing row would see the list flip to 'done' but
  // the drawer stuck on 'transcribing' until they clicked away — the
  // exact 'looks failed but data is fine' confusion that wasted time
  // during M7 debugging. See docs/corpus-transcription.md → Troubleshooting.
  useEffect(() => {
    if (!hasActiveTranscriptions) return;
    const t = setInterval(() => {
      void load();
      if (selectedId) void refreshDetail(selectedId);
    }, 15000);
    return () => clearInterval(t);
  }, [hasActiveTranscriptions, load, selectedId, refreshDetail]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const needle = titleFilter.trim().toLowerCase();
    if (!needle) return data.items;
    return data.items.filter((a) => a.TITLE.toLowerCase().includes(needle));
  }, [data, titleFilter]);

  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setChecked((prev) => {
      const allVisibleSelected = filteredRows.every((r) => prev.has(r.ID));
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of filteredRows) next.delete(r.ID);
      } else {
        for (const r of filteredRows) next.add(r.ID);
      }
      return next;
    });
  }

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    const ok = window.confirm(
      ids.length === 1
        ? 'Delete this artifact, its chunks, and the underlying blob?'
        : `Delete ${ids.length} artifacts (chunks + blobs)? This cannot be undone.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    setError(null);
    try {
      // Sequential to keep the load on Object Storage / DB predictable.
      // For our scale (dozens, not thousands) this is fine.
      for (const id of ids) {
        await deleteArtifact(id);
      }
      setChecked((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    setDetail(null);
    await refreshDetail(id);
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
              Every artifact you've ingested. {total.toLocaleString()} total
              {checked.size > 0 ? ` · ${checked.size} selected` : ''}.
            </p>
          </div>
          <div className="flex gap-2">
            {checked.size > 0 && (
              <button
                type="button"
                className="btn-danger text-sm"
                disabled={bulkBusy}
                onClick={() => void deleteIds(Array.from(checked))}
              >
                {bulkBusy
                  ? 'Deleting…'
                  : `Delete selected (${checked.size})`}
              </button>
            )}
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
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="Toggle select all visible"
                        checked={
                          filteredRows.length > 0 &&
                          filteredRows.every((r) => checked.has(r.ID))
                        }
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Origin</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2 text-right">Chunks</th>
                    <th
                      className="px-3 py-2 text-center"
                      title="Audio/video transcription status"
                    >
                      Transcript
                    </th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((a: ArtifactListItem) => {
                    const tagList = parseTags(a.TAGS);
                    const isSelected = a.ID === selectedId;
                    const isChecked = checked.has(a.ID);
                    return (
                      <tr
                        key={a.ID}
                        onClick={() => void handleSelect(a.ID)}
                        className={`cursor-pointer transition hover:bg-slate-50 ${
                          isSelected ? 'bg-brand-50' : ''
                        }`}
                      >
                        <td
                          className="px-2 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${a.TITLE}`}
                            checked={isChecked}
                            onChange={() => toggleChecked(a.ID)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">
                            {a.TITLE}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {a.NOTEBOOK_ID && (
                              <Link
                                to={`/library/${a.NOTEBOOK_ID}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-brand-100 hover:text-brand-800"
                                title={`From notebook ${a.NOTEBOOK_ID}`}
                              >
                                <span aria-hidden>📒</span>notebook
                              </Link>
                            )}
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
                        <td className="px-3 py-2 text-center text-xs">
                          <TranscriptionBadge
                            kind={a.KIND}
                            status={
                              (a.TRANSCRIPTION_STATUS as
                                | TranscriptionStatus
                                | null
                                | undefined) ?? null
                            }
                            error={a.TRANSCRIPTION_ERROR}
                          />
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
            id={selectedId}
            detail={detail}
            busy={detailBusy}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
            onMutated={() => {
              void refreshDetail(selectedId);
              void load();
            }}
            onDeleted={() => {
              setSelectedId(null);
              setDetail(null);
              void load();
            }}
          />
        ) : (
          <div className="card text-sm text-slate-600">
            Click a row to see its metadata, edit, share, or delete it.
          </div>
        )}
      </aside>
    </div>
  );
}

function DetailPanel({
  id,
  detail,
  busy,
  onClose,
  onMutated,
  onDeleted,
}: {
  id: string;
  detail: ArtifactDetail | null;
  busy: boolean;
  onClose: () => void;
  onMutated: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const a = (detail?.artifact ?? {}) as Record<string, unknown>;
  const get = (...keys: string[]): unknown => {
    for (const k of keys) if (a[k] != null) return a[k];
    return undefined;
  };
  const notebookId =
    typeof get('NOTEBOOK_ID', 'notebookId') === 'string'
      ? (get('NOTEBOOK_ID', 'notebookId') as string)
      : null;
  const md =
    (get('METADATA', 'metadata') as Record<string, unknown> | undefined) ?? {};
  const notebookTitle =
    typeof md['notebookTitle'] === 'string'
      ? (md['notebookTitle'] as string)
      : null;

  // ── Editing state (title + tags) ────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    const currentTags = parseTags(get('TAGS', 'tags'));
    setEditTitle(String(get('TITLE', 'title') ?? ''));
    setEditTags(currentTags.join(', '));
    setEditing(true);
    setEditError(null);
  }

  async function saveEdit() {
    setEditBusy(true);
    setEditError(null);
    try {
      const tags = editTags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 32);
      await updateArtifact(id, { title: editTitle.trim(), tags });
      setEditing(false);
      onMutated();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditBusy(false);
    }
  }

  // ── Single-row delete ──────────────────────────────────────────────
  const [deleteBusy, setDeleteBusy] = useState(false);
  async function handleDelete() {
    if (!window.confirm('Delete this artifact, its chunks, and the underlying blob?')) {
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteArtifact(id);
      onDeleted();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
    }
  }

  // ── Artifact viewer ───────────────────────────────────────────────
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewResult, setViewResult] = useState<ViewResult | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  async function handleView() {
    setViewBusy(true);
    setViewError(null);
    setViewResult(null);
    try {
      const r = await viewArtifact(id);
      setViewResult(r);
      setViewerOpen(true);
    } catch (err) {
      setViewError(err instanceof Error ? err.message : String(err));
    } finally {
      setViewBusy(false);
    }
  }

  // ── M7: transcription retry ────────────────────────────────────────
  const [transcribeBusy, setTranscribeBusy] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  // Track unmount so the burst-polling timeouts below don't fire
  // setState on a torn-down component (the React warning) or refetch
  // a row the user no longer cares about.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  async function handleTranscribe() {
    setTranscribeBusy(true);
    setTranscribeError(null);
    try {
      await transcribeArtifact(id);
      // The /transcribe endpoint returns 202 immediately; the actual
      // status flip from 'failed'/'skipped' → 'pending' → 'transcribing'
      // happens asynchronously on the server side a moment later. The
      // parent's 15s auto-refresh only kicks in once it sees a row in
      // a transient state — chicken-and-egg if we don't refresh fast
      // enough to catch the flip.
      //
      // So: fire onMutated immediately and again at 1s / 3s / 7s. By
      // the time the third refresh lands, the row is virtually
      // guaranteed to be in 'transcribing' (Speech submit takes ~1–2s),
      // and the parent's interval owns the long tail until SUCCEEDED
      // or FAILED. Capped at 7s — if Speech is still taking longer
      // than that to accept the job, the parent's 15s tick covers it.
      onMutated();
      for (const ms of [1000, 3000, 7000]) {
        window.setTimeout(() => {
          if (mountedRef.current) onMutated();
        }, ms);
      }
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribeBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            Artifact
          </div>
          <div className="truncate font-mono text-xs text-slate-600">
            {String(get('ID', 'id') ?? id)}
          </div>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          Close ✕
        </button>
      </div>

      {busy && <div className="text-sm text-slate-500">Loading…</div>}

      {detail && !editing && (
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

          {/* Tags */}
          {(() => {
            const tags = parseTags(get('TAGS', 'tags'));
            return (
              <div className="text-xs">
                <div className="text-slate-500">Tags</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {tags.length === 0 ? (
                    <span className="text-slate-400">none</span>
                  ) : (
                    tags.map((t) => (
                      <span key={t} className="badge">
                        #{t}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })()}

          {/* Notebook cross-link */}
          {notebookId && (
            <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs">
              <div className="text-slate-500">Originating notebook</div>
              <Link
                to={`/library/${notebookId}`}
                className="inline-flex items-center gap-1 text-brand-700 hover:underline"
              >
                <span aria-hidden>📒</span>
                {notebookTitle ?? notebookId}
                <span aria-hidden>↗</span>
              </Link>
            </div>
          )}

          {/* M7: transcription status + retry */}
          {(() => {
            const kindStr = String(get('KIND', 'kind') ?? '');
            if (!AUDIO_VIDEO_KINDS.has(kindStr)) return null;
            const status = ((get('TRANSCRIPTION_STATUS', 'transcriptionStatus') ??
              null) as TranscriptionStatus | null);
            const trxError = get('TRANSCRIPTION_ERROR', 'transcriptionError') as
              | string
              | null
              | undefined;
            const trxAt = get('TRANSCRIBED_AT', 'transcribedAt') as
              | string
              | null
              | undefined;
            const statusLabel: Record<TranscriptionStatus, string> = {
              pending: 'Queued for transcription',
              transcribing: 'Transcribing…',
              done: 'Transcribed',
              failed: 'Transcription failed',
              skipped: 'Transcription skipped',
            };
            const isInFlight = status === 'pending' || status === 'transcribing';
            const canRetry = !isInFlight;
            return (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TranscriptionBadge
                      kind={kindStr}
                      status={status}
                      error={trxError}
                    />
                    <span className="text-slate-700">
                      {status ? statusLabel[status] : 'Not transcribed yet'}
                    </span>
                  </div>
                  {canRetry && (
                    <button
                      type="button"
                      className="btn-secondary text-[11px]"
                      disabled={transcribeBusy}
                      onClick={() => void handleTranscribe()}
                      title={
                        status === 'done'
                          ? 'Re-run transcription (will replace existing chunks)'
                          : 'Run transcription now'
                      }
                    >
                      {transcribeBusy
                        ? 'Queuing…'
                        : status === 'done'
                          ? 'Re-transcribe'
                          : 'Transcribe'}
                    </button>
                  )}
                </div>
                {typeof trxAt === 'string' && status === 'done' && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    {formatDate(trxAt)}
                  </div>
                )}
                {status === 'failed' && trxError && (
                  <div className="mt-1 text-[11px] text-rose-700">
                    {trxError}
                  </div>
                )}
                {transcribeError && (
                  <div className="mt-1 text-[11px] text-rose-700">
                    {transcribeError}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <a
              href={detail.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary text-xs"
            >
              Download blob ↗
            </a>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={viewBusy}
              onClick={() => void handleView()}
            >
              {viewBusy ? 'Loading…' : 'View'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={startEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn-danger text-xs"
              disabled={deleteBusy}
              onClick={() => void handleDelete()}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
          {viewError && (
            <p className="text-[11px] text-rose-600">{viewError}</p>
          )}
          <p className="text-[11px] text-slate-500">
            PAR valid until {formatDate(detail.expiresAt)}
          </p>
          {viewerOpen && viewResult && (
            <ArtifactViewer
              title={String(get('TITLE', 'title') ?? 'Artifact')}
              result={viewResult}
              onClose={() => setViewerOpen(false)}
            />
          )}
          <ShareControls id={id} />
          {editError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
              {editError}
            </div>
          )}
        </>
      )}

      {detail && editing && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="edit-title">
              Title
            </label>
            <input
              id="edit-title"
              className="input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={512}
              disabled={editBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-tags">
              Tags <span className="text-slate-400">(comma-separated)</span>
            </label>
            <input
              id="edit-tags"
              className="input"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              disabled={editBusy}
              placeholder="q2-earnings, tencent"
            />
          </div>
          {editError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
              {editError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={editBusy || editTitle.trim().length === 0}
              onClick={() => void saveEdit()}
            >
              {editBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={editBusy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactViewer({
  title,
  result,
  onClose,
}: {
  title: string;
  result: ViewResult;
  onClose: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'f' || e.key === 'F') setExpanded((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60${expanded ? '' : ' p-4'}`}
      onClick={onClose}
    >
      <div
        className={`flex flex-col bg-white${
          expanded
            ? ' h-screen w-screen'
            : ' h-[90vh] w-[90vw] max-w-6xl rounded-xl shadow-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
          <div className="ml-4 flex shrink-0 items-center gap-3">
            <a
              href={result.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs"
            >
              Download ↗
            </a>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Exit full screen (F)' : 'Full screen (F)'}
            >
              {expanded ? '⤡ Exit full screen' : '⤢ Full screen'}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={onClose}>
              Close ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {result.type === 'pdf' && (
            <iframe
              src={result.downloadUrl}
              className="h-full w-full border-0"
              title={title}
            />
          )}
          {result.type === 'office' && result.officeViewerUrl && (
            <iframe
              src={result.officeViewerUrl}
              className="h-full w-full border-0"
              title={title}
            />
          )}
          {result.type === 'html' && result.content && (
            <div
              className="h-full overflow-y-auto p-6 text-sm text-slate-800 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:font-medium [&_li]:ml-4 [&_ol]:mb-3 [&_ol]:list-decimal [&_p]:mb-3 [&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:text-left [&_ul]:mb-3 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: result.content }}
            />
          )}
          {result.type === 'text' && result.content && (
            <pre className="h-full overflow-auto whitespace-pre-wrap p-6 font-mono text-sm text-slate-800">
              {result.content}
            </pre>
          )}
          {result.type === 'unsupported' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-slate-600">
              <p className="text-sm">
                Inline preview is not available for this file type
                {result.mimeType ? ` (${result.mimeType})` : ''}.
              </p>
              <a
                href={result.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                Download file ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
