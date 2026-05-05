import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIFACT_KINDS,
  getArtifact,
  getCorpusHealth,
  searchCorpus,
  shareArtifact,
  type ArtifactDetail,
  type ArtifactKind,
  type CorpusHealth,
  type SearchHit,
  type SearchResult,
  type ShareResult,
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

function DetailPanel({
  id,
  detail,
  busy,
  onClose,
}: {
  id: string;
  detail: ArtifactDetail | null;
  busy: boolean;
  onClose: () => void;
}): JSX.Element {
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

      {detail && (
        <>
          <div className="space-y-1 text-sm">
            <ArtifactKvRow detail={detail} />
          </div>
          <NotebookLinkRow detail={detail} />
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <a
              href={detail.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary w-full"
            >
              Download blob ↗
            </a>
            <p className="text-[11px] text-slate-500">
              PAR valid until {formatDate(detail.expiresAt)}
            </p>
            <ShareControls id={id} />
          </div>
        </>
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
