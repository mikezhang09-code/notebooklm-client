import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  deleteArtifact,
  getArtifact,
  getCorpusHealth,
  searchCorpus,
  shareArtifact,
  updateArtifact,
  viewArtifact,
  type ArtifactDetail,
  type ArtifactKind,
  type CorpusHealth,
  type SearchHit,
  type SearchResult,
  type ShareResult,
  type ViewResult,
} from '../lib/corpus';

/**
 * /corpus — semantic search across the personal research corpus.
 *
 * Layout:
 *  - Header with status pill (db / storage / genai)
 *  - Search form (query + kind filter + threshold slider)
 *  - Results list (cards grouped by artifact, expandable snippets)
 *  - Selected artifact panel (chunks + signed PAR download URL)
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

function formatDistance(d: number): string {
  if (!Number.isFinite(d)) return '—';
  return d.toFixed(3);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** Map cosine distance to a simple semantic label. */
function distanceLabel(d: number): { text: string; cls: string } {
  if (d <= 0.45) return { text: 'Strong match', cls: 'bg-emerald-100 text-emerald-800' };
  if (d <= 0.6) return { text: 'Good match', cls: 'bg-blue-100 text-blue-800' };
  if (d <= 0.7) return { text: 'Possible match', cls: 'bg-amber-100 text-amber-800' };
  return { text: 'Weak', cls: 'bg-slate-100 text-slate-700' };
}

export default function CorpusPage() {
  const [health, setHealth] = useState<CorpusHealth | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ArtifactKind | ''>('');
  const [maxDistance, setMaxDistance] = useState<number>(0.75);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  // Detail panel state — when user clicks a hit, fetch its PAR URL.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCorpusHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch((err) => {
        if (!cancelled) setHealthErr(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);
    setError(null);
    setResult(null);
    setSelectedId(null);
    setDetail(null);
    try {
      const data = await searchCorpus({
        query: query.trim(),
        kind: kind || undefined,
        maxDistance: maxDistance >= 1 ? undefined : maxDistance,
        artifactLimit: 10,
        snippetsPerArtifact: 3,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(hit: SearchHit) {
    setSelectedId(hit.artifact.id);
    setDetail(null);
    setDetailBusy(true);
    try {
      const d = await getArtifact(hit.artifact.id);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailBusy(false);
    }
  }

  async function refreshDetail(id: string) {
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

  const subsystemDisabled = useMemo(() => {
    if (!health) return false;
    return !health.enabled;
  }, [health]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="space-y-4">
        {/* Header + health */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Research corpus</h1>
            <HealthPill health={health} error={healthErr} />
          </div>
          <p className="text-sm text-slate-600">
            Semantic search over every artifact you've ingested. Powered by Oracle
            ADB <code className="rounded bg-slate-100 px-1">VECTOR(1024)</code> + OCI
            Generative AI multilingual embeddings.
          </p>
        </div>

        {subsystemDisabled && (
          <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
            Corpus is disabled — set the OCI / Oracle env vars in <code>.env</code> to
            enable. See <code>webapp/README.md</code>.
          </div>
        )}

        {/* Search form */}
        <form onSubmit={handleSearch} className="card space-y-3">
          <div>
            <label className="label" htmlFor="corpus-query">
              Query
            </label>
            <input
              id="corpus-query"
              type="text"
              className="input"
              placeholder='e.g. "Tencent gaming acceleration", "广告 AI 增长", "research findings on X"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={busy || subsystemDisabled}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="corpus-kind">
                Kind
              </label>
              <select
                id="corpus-kind"
                className="input"
                value={kind}
                onChange={(e) => setKind((e.target.value as ArtifactKind) || '')}
                disabled={busy || subsystemDisabled}
              >
                <option value="">All kinds</option>
                {ARTIFACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k] ?? k}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label flex items-center justify-between" htmlFor="corpus-thresh">
                <span>Max distance (looser ←→ stricter)</span>
                <span className="font-mono text-xs text-slate-500">
                  {maxDistance >= 1 ? 'off' : maxDistance.toFixed(2)}
                </span>
              </label>
              <input
                id="corpus-thresh"
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={maxDistance}
                onChange={(e) => setMaxDistance(Number(e.target.value))}
                disabled={busy || subsystemDisabled}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-slate-200 pt-3">
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || subsystemDisabled || !query.trim()}
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
            {result && (
              <span className="text-xs text-slate-500">
                {result.hits.length} hit{result.hits.length === 1 ? '' : 's'} ·{' '}
                scanned {result.candidatesScanned} chunks · embed {result.embedMs}ms ·{' '}
                sql {result.sqlMs}ms
              </span>
            )}
          </div>
        </form>

        {error && (
          <div className="card border-rose-300 bg-rose-50 text-sm text-rose-900">{error}</div>
        )}

        {/* Results */}
        {result && result.hits.length === 0 && !busy && (
          <div className="card text-sm text-slate-600">
            No hits. Try loosening the distance threshold or removing filters.
          </div>
        )}

        <div className="space-y-3">
          {result?.hits.map((hit) => (
            <HitCard
              key={hit.artifact.id}
              hit={hit}
              isSelected={hit.artifact.id === selectedId}
              onSelect={() => handleSelect(hit)}
            />
          ))}
        </div>
      </div>

      {/* Right rail: artifact detail */}
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
            onMutated={() => void refreshDetail(selectedId)}
            onDeleted={() => {
              const gone = selectedId;
              setSelectedId(null);
              setDetail(null);
              setResult((prev) =>
                prev
                  ? { ...prev, hits: prev.hits.filter((h) => h.artifact.id !== gone) }
                  : prev,
              );
            }}
          />
        ) : (
          <div className="card text-sm text-slate-600">
            Click a result on the left to see all matching chunks and a 1-hour
            download link.
          </div>
        )}
      </aside>
    </div>
  );
}

function HealthPill({
  health,
  error,
}: {
  health: CorpusHealth | null;
  error: string | null;
}): JSX.Element {
  if (error) {
    return <span className="badge bg-rose-100 text-rose-800">health: {error}</span>;
  }
  if (!health) return <span className="badge">checking…</span>;
  if (!health.enabled) {
    return <span className="badge bg-amber-100 text-amber-800">disabled</span>;
  }
  const allOk = health.db.ok && health.storage.ok && health.genai.ok;
  if (allOk) {
    return (
      <span
        className="badge bg-emerald-100 text-emerald-800"
        title={`db: ${health.db.user} · ${health.db.version?.split(' Release')[0]}\nstorage: ${health.storage.bucket}\ngenai: ${health.genai.model} (${health.genai.dimensions}d)`}
      >
        all systems go
      </span>
    );
  }
  const failing: string[] = [];
  if (!health.db.ok) failing.push('db');
  if (!health.storage.ok) failing.push('storage');
  if (!health.genai.ok) failing.push('genai');
  return (
    <span className="badge bg-rose-100 text-rose-800" title={JSON.stringify(health, null, 2)}>
      degraded: {failing.join(', ')}
    </span>
  );
}

function HitCard({
  hit,
  isSelected,
  onSelect,
}: {
  hit: SearchHit;
  isSelected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const a = hit.artifact;
  const dl = distanceLabel(hit.bestDistance);
  const notebookTitle =
    typeof a.metadata?.['notebookTitle'] === 'string'
      ? (a.metadata['notebookTitle'] as string)
      : null;
  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      className={`w-full cursor-pointer rounded-lg border bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 ${
        isSelected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-brand">{KIND_LABELS[a.kind] ?? a.kind}</span>
            <span className={`badge ${dl.cls}`}>{dl.text}</span>
            <span className="font-mono text-xs text-slate-500">
              dist {formatDistance(hit.bestDistance)}
            </span>
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-slate-900">
            {a.title}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
            <span>{formatDate(a.createdAt)}</span>
            <span>·</span>
            <span>{formatBytes(a.sizeBytes)}</span>
            <span>·</span>
            <span>
              {hit.snippets.length} matching chunk
              {hit.snippets.length === 1 ? '' : 's'}
            </span>
            {a.notebookId && (
              <>
                <span>·</span>
                <Link
                  to={`/library/${a.notebookId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-brand-100 hover:text-brand-800"
                  title={`From notebook ${a.notebookId}`}
                >
                  <span aria-hidden>📒</span>
                  {notebookTitle ?? 'Notebook'}
                </Link>
              </>
            )}
            {a.tags.length > 0 &&
              a.tags.map((t) => (
                <span key={t} className="badge ml-1">
                  #{t}
                </span>
              ))}
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {hit.snippets.map((s) => (
          <li
            key={s.chunkId}
            className="rounded-md bg-slate-50 p-2 text-sm leading-relaxed text-slate-800"
          >
            <div className="mb-1 font-mono text-[10px] text-slate-400">
              chunk #{s.ordinal} · dist {formatDistance(s.distance)} · chars{' '}
              {s.charStart}–{s.charEnd}
            </div>
            <div className="line-clamp-3 whitespace-pre-wrap">{s.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
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

  // ── Edit state ────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    setEditTitle(String(get('TITLE', 'title') ?? ''));
    setEditTags(parseTags(get('TAGS', 'tags')).join(', '));
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

  // ── Delete state ──────────────────────────────────────────────────
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm('Delete this artifact, its chunks, and the underlying blob?')) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteArtifact(id);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
    }
  }

  // ── View state ────────────────────────────────────────────────────
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

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-400">Artifact</div>
          <div className="truncate font-mono text-xs text-slate-600">{id}</div>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          Close ✕
        </button>
      </div>

      {busy && <div className="text-sm text-slate-500">Loading…</div>}

      {detail && !editing && (
        <>
          <div className="space-y-1 text-sm">
            <ArtifactKvRow detail={detail} />
          </div>

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
                      <span key={t} className="badge">#{t}</span>
                    ))
                  )}
                </div>
              </div>
            );
          })()}

          <NotebookLinkRow detail={detail} />

          <div className="border-t border-slate-200 pt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <a
                href={detail.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary text-xs"
              >
                Download ↗
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
            {viewError && <p className="text-[11px] text-rose-600">{viewError}</p>}
            {deleteError && <p className="text-[11px] text-rose-600">{deleteError}</p>}
            <p className="text-[11px] text-slate-500">
              PAR valid until {formatDate(detail.expiresAt)}
            </p>
            <ShareControls id={id} />
          </div>

          {viewerOpen && viewResult && (
            <ArtifactViewer
              title={String(get('TITLE', 'title') ?? 'Artifact')}
              result={viewResult}
              onClose={() => setViewerOpen(false)}
            />
          )}
        </>
      )}

      {detail && editing && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="cp-edit-title">Title</label>
            <input
              id="cp-edit-title"
              className="input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={512}
              disabled={editBusy}
            />
          </div>
          <div>
            <label className="label" htmlFor="cp-edit-tags">
              Tags <span className="text-slate-400">(comma-separated)</span>
            </label>
            <input
              id="cp-edit-tags"
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

function NotebookLinkRow({ detail }: { detail: ArtifactDetail }): JSX.Element | null {
  const a = (detail.artifact ?? {}) as Record<string, unknown>;
  const notebookId =
    typeof a['NOTEBOOK_ID'] === 'string'
      ? (a['NOTEBOOK_ID'] as string)
      : typeof a['notebookId'] === 'string'
      ? (a['notebookId'] as string)
      : null;
  if (!notebookId) return null;
  const md =
    (a['METADATA'] as Record<string, unknown> | undefined) ??
    (a['metadata'] as Record<string, unknown> | undefined) ??
    {};
  const notebookTitle =
    typeof md['notebookTitle'] === 'string'
      ? (md['notebookTitle'] as string)
      : null;
  return (
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
  );
}

/**
 * Tiny share-link generator — ships a copyable URL with a TTL of 1h..7d.
 * Used inside both CorpusPage and CorpusLibraryPage detail panels.
 */
export function ShareControls({ id }: { id: string }): JSX.Element {
  const [ttl, setTtl] = useState(24);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await shareArtifact(id, ttl);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can manually copy from the input
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <div className="mb-1 font-medium text-slate-600">Share link</div>
      <div className="flex items-center gap-2">
        <select
          className="input h-7 text-xs"
          value={ttl}
          onChange={(e) => setTtl(parseInt(e.target.value, 10))}
          disabled={busy}
        >
          <option value={1}>1 hour</option>
          <option value={24}>24 hours</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
        </select>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? '…' : result ? 'Re-issue' : 'Generate'}
        </button>
      </div>
      {error && <div className="mt-1 text-rose-700">{error}</div>}
      {result && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-1">
            <input
              readOnly
              value={result.shareUrl}
              className="input h-7 flex-1 font-mono text-[11px]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => void copy()}
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
          <div className="text-[10px] text-slate-500">
            Expires {new Date(result.expiresAt).toLocaleString()} ·{' '}
            {result.ttlHours}h TTL
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactKvRow({ detail }: { detail: ArtifactDetail }): JSX.Element {
  // The artifact row comes from oracledb in mixed-case keys.
  const a = (detail.artifact ?? {}) as Record<string, unknown>;
  function get(...keys: string[]): unknown {
    for (const k of keys) {
      if (a[k] != null) return a[k];
    }
    return undefined;
  }
  const rows: { label: string; value: unknown }[] = [
    { label: 'Title', value: get('TITLE', 'title') },
    { label: 'Kind', value: get('KIND', 'kind') },
    { label: 'Origin', value: get('ORIGIN', 'origin') },
    { label: 'MIME', value: get('MIME_TYPE', 'mimeType') ?? '—' },
    { label: 'Size', value: typeof get('SIZE_BYTES', 'sizeBytes') === 'number' ? formatBytes(get('SIZE_BYTES', 'sizeBytes') as number) : '—' },
    { label: 'Bucket', value: get('BUCKET', 'bucket') },
    { label: 'Object', value: get('OBJECT_NAME', 'objectName') },
    { label: 'Created', value: typeof get('CREATED_AT', 'createdAt') === 'string' ? formatDate(get('CREATED_AT', 'createdAt') as string) : '—' },
  ];
  return (
    <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-slate-500">{r.label}</dt>
          <dd className="truncate text-slate-800" title={String(r.value ?? '')}>
            {String(r.value ?? '—')}
          </dd>
        </div>
      ))}
    </dl>
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
        <div className="min-h-0 flex-1 overflow-hidden">
          {result.type === 'pdf' && (
            <iframe src={result.downloadUrl} className="h-full w-full border-0" title={title} />
          )}
          {result.type === 'office' && result.officeViewerUrl && (
            <iframe src={result.officeViewerUrl} className="h-full w-full border-0" title={title} />
          )}
          {result.type === 'html' && result.content && (
            <div
              className="h-full overflow-y-auto p-6 text-sm text-slate-800 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:font-medium [&_li]:ml-4 [&_ol]:mb-3 [&_ol]:list-decimal [&_p]:mb-3 [&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-1 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:p-1 [&_ul]:mb-3 [&_ul]:list-disc"
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
