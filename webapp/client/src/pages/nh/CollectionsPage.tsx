/**
 * Library · Collections — browse user-created collections of uploaded research.
 * Wired to GET/POST /api/corpus/collections.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { TYPE, TYPES, type TypeKey } from '../../lib/registry';
import {
  listCollections,
  createCollection,
  kindToTypeKey,
  timeAgo,
  type CollectionSummary,
} from '../../lib/collections';
import { toast } from '../../lib/toast';

function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TYPES[h % TYPES.length].color;
}

export default function CollectionsPage() {
  const navigate = useNavigate();
  const [cols, setCols] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const { collections } = await listCollections();
      setCols(collections);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="content">
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: 'var(--accent)' }} />
              Library · Collections
            </div>
            <div className="view-title">
              <h1>Collections</h1>
            </div>
            <p className="view-sub">
              Group your own uploaded research. Each collection holds related files and the
              artifacts you generate or save into it.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon id="i-plus" />
            New collection
          </button>
        </div>
      </div>

      {error && (
        <div className="empty" style={{ color: 'var(--accent)' }}>
          {error}
        </div>
      )}

      <div className="grid">
        {cols.map((c) => {
          const tc = colorFor(c.id);
          const minis = Object.entries(c.breakdown).slice(0, 6);
          return (
            <div
              key={c.id}
              className="col-card"
              style={{ '--tc': tc } as React.CSSProperties}
              onClick={() => navigate(`/collections/${c.id}`)}
            >
              <div className="col-cover">
                <div className="pat" />
                <span className="fic">
                  <Icon id="i-folder" />
                </span>
              </div>
              <div className="col-body">
                <div className="nb-cat">{c.tags[0] ?? 'Collection'}</div>
                <h3>{c.name}</h3>
                <div className="col-mini">
                  {minis.map(([kind, n]) => {
                    const t = TYPE[kindToTypeKey(kind) as TypeKey];
                    if (!t) return null;
                    return (
                      <span
                        key={kind}
                        className="mk"
                        style={{ '--mk': t.color } as React.CSSProperties}
                      >
                        <Icon id={t.icon} />
                        <span className="ct">{n}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="col-foot">
                  <span>{c.itemCount} items</span>
                  <span className="upd">
                    <Icon id="i-clock" />
                    {timeAgo(c.updatedAt)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && (
          <button className="new-tile" onClick={() => setCreating(true)}>
            <span className="plus">
              <Icon id="i-plus" />
            </span>
            <b>New collection</b>
            <small>Group your uploads</small>
          </button>
        )}
      </div>

      {loading && <div className="empty">Loading collections…</div>}

      {creating && (
        <CreateCollectionModal
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            toast(`Collection "${c.name}" created`);
            navigate(`/collections/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateCollectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: CollectionSummary) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createCollection({
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <div className="modal-root show" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ '--tc': 'var(--accent)' } as React.CSSProperties}>
          <div className="modal-pad">
            <div className="modal-tt">
              <div>
                <div className="m-type">New collection</div>
                <h2>Create a collection</h2>
                <p className="m-desc">A named bag for related uploads and artifacts.</p>
              </div>
              <button className="icon-btn" onClick={onClose}>
                <Icon id="i-close" />
              </button>
            </div>
            <form onSubmit={submit}>
              <div className="field">
                <label>Name</label>
                <input
                  className="input"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Q3 Competitive Teardown"
                />
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <textarea
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this collection is for…"
                />
              </div>
              <div className="field">
                <label>Tags (optional, comma-separated)</label>
                <input
                  className="input"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="strategy, q3"
                />
              </div>
              {error && (
                <p className="hint" style={{ color: 'var(--accent)' }}>
                  {error}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button className="btn btn-primary" disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : 'Create collection'}
                </button>
                <button type="button" className="btn btn-soft" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
