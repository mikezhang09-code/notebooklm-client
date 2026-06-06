/**
 * Free Forms overview — every artifact grouped by output type, with a 4-card
 * preview per type and a "See all" into the per-type table. Wired to
 * GET /api/corpus/artifacts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import ItemCard from '../../components/ItemCard';
import ItemModal from '../../components/ItemModal';
import { TypePicker, CreateChooser } from '../../components/CreateFlow';
import UploadDrawer from '../../components/UploadDrawer';
import GenerateStandaloneDrawer from '../../components/GenerateStandaloneDrawer';
import MarkdownEditor from '../../components/MarkdownEditor';
import { TYPES, type TypeKey } from '../../lib/registry';
import { listItems, fetchNotebookMap, resolveFrom, type Item } from '../../lib/artifacts';

export default function FreeFormsOverviewPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

  // Creation flow state.
  const [picking, setPicking] = useState(false);
  const [chooseType, setChooseType] = useState<TypeKey | null>(null);
  const [uploadType, setUploadType] = useState<TypeKey | null>(null);
  const [genType, setGenType] = useState<TypeKey | null>(null);
  const [noteEditing, setNoteEditing] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [{ items }, nbMap] = await Promise.all([
        listItems({ limit: 500 }),
        fetchNotebookMap(),
      ]);
      setItems(items.map((it) => ({ ...it, from: resolveFrom(it, nbMap) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  const byType = useMemo(() => {
    const m = new Map<TypeKey, Item[]>();
    for (const it of items) {
      const arr = m.get(it.typeKey) ?? [];
      arr.push(it);
      m.set(it.typeKey, arr);
    }
    return m;
  }, [items]);

  const sections = TYPES.filter((t) => (byType.get(t.key)?.length ?? 0) > 0);

  return (
    <div className="content">
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: '#8a7c4a' }} />
              Free Forms
            </div>
            <div className="view-title">
              <h1>Free Forms</h1>
            </div>
            <p className="view-sub">
              Every generated and uploaded artifact, organized by output type with provenance back
              to its source.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setPicking(true)}>
            <Icon id="i-plus" />
            New free form
          </button>
        </div>
      </div>

      {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}
      {!loading && items.length === 0 && !error && (
        <div className="empty">
          <Icon id="i-spark" />
          <p>No artifacts yet. Generate one inside a notebook, or upload a file.</p>
        </div>
      )}

      {sections.map((t) => {
        const list = byType.get(t.key) ?? [];
        return (
          <div className="ff-section" key={t.key} style={{ '--tc': t.color } as React.CSSProperties}>
            <div className="ff-sec-head">
              <span className="s-ic">
                <Icon id={t.icon} />
              </span>
              <h2>{t.plural}</h2>
              {t.isNew && <span className="n-new">New</span>}
              <span className="s-count">{list.length}</span>
              <button className="chip s-all" onClick={() => navigate(`/free-forms/${t.key}`)}>
                See all ›
              </button>
            </div>
            <div className="item-grid">
              {list.slice(0, 4).map((it) => (
                <ItemCard key={it.id} item={it} onOpen={setOpen} />
              ))}
            </div>
          </div>
        );
      })}

      {loading && <div className="empty">Loading artifacts…</div>}

      {open && <ItemModal item={open} onClose={() => setOpen(null)} onDeleted={reload} />}

      {picking && (
        <TypePicker
          onClose={() => setPicking(false)}
          onPick={(key) => {
            setPicking(false);
            if (key === 'note') setNoteEditing(true);
            else setChooseType(key);
          }}
        />
      )}
      {chooseType && (
        <CreateChooser
          typeKey={chooseType}
          onClose={() => setChooseType(null)}
          onUpload={() => {
            setUploadType(chooseType);
            setChooseType(null);
          }}
          onGenerate={() => {
            setGenType(chooseType);
            setChooseType(null);
          }}
        />
      )}
      {uploadType && (
        <UploadDrawer
          typeKey={uploadType}
          onClose={() => setUploadType(null)}
          onUploaded={() => {
            setUploadType(null);
            void reload();
          }}
        />
      )}
      {genType && (
        <GenerateStandaloneDrawer
          typeKey={genType}
          onClose={() => setGenType(null)}
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
