/**
 * Free Forms · single type — a table of all items of one output type, with a
 * provenance filter (All / NotebookLM / Collections / Free form) and the item
 * detail modal. Wired to GET /api/corpus/artifacts?kind=…
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import CorpusChat from '../../components/CorpusChat';
import ItemModal from '../../components/ItemModal';
import { CreateChooser } from '../../components/CreateFlow';
import UploadDrawer from '../../components/UploadDrawer';
import GenerateStandaloneDrawer from '../../components/GenerateStandaloneDrawer';
import MarkdownEditor from '../../components/MarkdownEditor';
import { TYPE, SOURCES, type TypeKey } from '../../lib/registry';
import { listItems, fetchNotebookMap, resolveFrom, type Item, type Provenance } from '../../lib/artifacts';

type Filter = 'all' | Provenance;
const FILTERS: { key: Filter; label: string; dot?: string }[] = [
  { key: 'all', label: 'All sources' },
  { key: 'notebooklm', label: 'NotebookLM', dot: SOURCES.notebooklm.color },
  { key: 'personal', label: 'Collections', dot: SOURCES.personal.color },
  { key: 'standalone', label: 'Free form', dot: SOURCES.standalone.color },
];

function fmtSize(b: number | null): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function FreeFormTypePage() {
  const { type } = useParams<{ type: string }>();
  const typeKey = (type ?? 'audio') as TypeKey;
  const t = TYPE[typeKey] ?? TYPE.report;

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [tab, setTab] = useState<'list' | 'chat'>('list');

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      // Fetch everything and bucket by display type (uploads + generated
      // artifacts share these sections), and resolve notebook names for "From".
      const [{ items: all }, nbMap] = await Promise.all([
        listItems({ limit: 500 }),
        fetchNotebookMap(),
      ]);
      setItems(
        all
          .filter((it) => it.typeKey === typeKey)
          .map((it) => ({ ...it, from: resolveFrom(it, nbMap) })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [typeKey]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, notebooklm: 0, personal: 0, standalone: 0 };
    for (const it of items) c[it.provenance]++;
    return c;
  }, [items]);

  // Distinct tags across this type's items, most-used first.
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) for (const tg of it.tags) m.set(tg, (m.get(tg) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const rows = items.filter(
    (it) =>
      (filter === 'all' || it.provenance === filter) &&
      (activeTag === null || it.tags.includes(activeTag)),
  );
  // Distinct backend kinds backing this display type (e.g. data-table + data_table).
  const kinds = useMemo(() => [...new Set(items.map((it) => it.kind))], [items]);

  return (
    <div className="content" style={{ '--tc': t.color } as React.CSSProperties}>
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: t.color }} />
              Free Forms · {t.plural}
            </div>
            <div className="view-title">
              <span className="t-ic" style={{ width: 42, height: 42 }}>
                <Icon id={t.icon} />
              </span>
              <h1>{t.plural}</h1>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setChoosing(true)}>
            <Icon id="i-plus" />
            New {t.label.toLowerCase()}
          </button>
        </div>
      </div>

      <div className="seg" style={{ width: 'fit-content', marginBottom: 16 }}>
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>
          <Icon id={t.icon} /> {t.plural}
        </button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          <Icon id="i-chat" /> Chat
        </button>
      </div>

      {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}

      {tab === 'chat' && (
        <CorpusChat
          scope={{ kinds: kinds.length > 0 ? kinds : undefined }}
          title={`Chat with your ${t.plural.toLowerCase()}`}
          subtitle={`Answers are grounded in your ${items.length} ${t.plural.toLowerCase()} across all sources, with citations.`}
          placeholder={`Ask about your ${t.plural.toLowerCase()}…`}
          accent={t.color}
        />
      )}

      {tab === 'list' && (
        <div className="chips" style={{ marginBottom: 16 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.dot && <span className="c-dot" style={{ background: f.dot }} />}
              {f.label}
              <span className="c-x">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'list' && tagCounts.length > 0 && (
        <div className="chips" style={{ marginBottom: 16 }}>
          <button
            className={`chip${activeTag === null ? ' on' : ''}`}
            onClick={() => setActiveTag(null)}
          >
            All tags
          </button>
          {tagCounts.map(([tag, count]) => (
            <button
              key={tag}
              className={`chip${activeTag === tag ? ' on' : ''}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              #{tag}
              <span className="c-x">{count}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'list' &&
        (!loading && rows.length === 0 ? (
        <div className="empty">
          <Icon id={t.icon} />
          <p>No {t.plural.toLowerCase()} yet.</p>
        </div>
      ) : (
        <div className="ff-table">
          <div className="fft-head">
            <span>Name</span>
            <span>Source</span>
            <span>From</span>
            <span>Details</span>
            <span>Created</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>
          {rows.map((it) => {
            const src = SOURCES[it.provenance];
            return (
              <div key={it.id} className="fft-row" onClick={() => setOpen(it)}>
                <div className="fft-name">
                  <span className="t-ic" style={{ width: 32, height: 32 }}>
                    <Icon id={t.icon} />
                  </span>
                  <div className="fft-name-col">
                    <span className="fft-nm">{it.title}</span>
                    {it.tags.length > 0 && (
                      <span className="item-tags">
                        {it.tags.slice(0, 4).map((tag) => (
                          <button
                            key={tag}
                            className="tag-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTag(activeTag === tag ? null : tag);
                            }}
                          >
                            #{tag}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <span>
                  <span className={`prov p-${it.provenance}`}>
                    <Icon id={src.icon} /> {src.label}
                  </span>
                </span>
                <span className="fft-from">{it.from ?? '—'}</span>
                <span className="fft-mono">{fmtSize(it.sizeBytes)}</span>
                <span className="fft-date">{new Date(it.createdAt).toLocaleDateString()}</span>
                <div className="fft-act" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => setOpen(it)}>
                    <Icon id="i-ext" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        ))}

      {tab === 'list' && loading && <div className="empty">Loading…</div>}

      {open && <ItemModal item={open} onClose={() => setOpen(null)} onDeleted={reload} />}

      {choosing && (
        <CreateChooser
          typeKey={typeKey}
          onClose={() => setChoosing(false)}
          onUpload={() => {
            setChoosing(false);
            setUploading(true);
          }}
          onGenerate={() => {
            setChoosing(false);
            setGenerating(true);
          }}
          onWrite={
            typeKey === 'note'
              ? () => {
                  setChoosing(false);
                  setNoteEditing(true);
                }
              : undefined
          }
        />
      )}
      {uploading && (
        <UploadDrawer
          typeKey={typeKey}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            void reload();
          }}
        />
      )}
      {generating && (
        <GenerateStandaloneDrawer
          typeKey={typeKey}
          onClose={() => setGenerating(false)}
          onDone={() => void reload()}
        />
      )}
      {noteEditing && (
        <MarkdownEditor
          onClose={() => setNoteEditing(false)}
          onSaved={() => {
            setNoteEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
