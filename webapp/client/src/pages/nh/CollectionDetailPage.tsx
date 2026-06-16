/**
 * Collection detail — files table + upload (real, files land in this collection
 * via POST /api/corpus/ingest?collectionId). Generate-from-collection is wired
 * in a later phase.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import CorpusChat from '../../components/CorpusChat';
import ItemModal from '../../components/ItemModal';
import MarkdownEditor from '../../components/MarkdownEditor';
import QuizEditor from '../../components/QuizEditor';
import FlashcardsEditor from '../../components/FlashcardsEditor';
import MindmapEditor from '../../components/MindmapEditor';
import DiagramEditor from '../../components/DiagramEditor';
import UploadDrawer from '../../components/UploadDrawer';
import { TypePicker, CreateChooser } from '../../components/CreateFlow';
import GenerateFromCollectionDrawer from '../../components/GenerateFromCollectionDrawer';
import { describe, TYPE, type TypeKey } from '../../lib/registry';
import {
  getCollection,
  updateCollection,
  deleteCollection,
  kindToTypeKey,
  timeAgo,
  type CollectionDetail,
  type CollectionFile,
} from '../../lib/collections';
import type { Item } from '../../lib/artifacts';
import { toast } from '../../lib/toast';

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [col, setCol] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  // Quiz / flashcards / mind maps offer build-by-hand, generate, or upload.
  const [chooseType, setChooseType] = useState<TypeKey | null>(null);
  const [buildType, setBuildType] = useState<TypeKey | null>(null);
  // Generate any type from this collection's own files (quiz/flash/mind can
  // also use the in-app AI; everything else is NotebookLM-only).
  const [genFromType, setGenFromType] = useState<TypeKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'files' | 'chat'>('files');

  function fileToItem(f: CollectionFile): Item {
    return {
      id: f.id,
      kind: f.kind,
      typeKey: kindToTypeKey(f.kind) as TypeKey,
      provenance: 'personal',
      title: f.title,
      from: col?.name ?? null,
      artifactId: null,
      notebookId: null,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
      chunkCount: 0,
      tags: [],
      description: null,
    };
  }

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setCol(await getCollection(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [id]);

  async function handleDelete() {
    if (!id || !col) return;
    if (!confirm(`Delete collection "${col.name}"? Its ${col.itemCount} items become free-form (not deleted).`))
      return;
    try {
      await deleteCollection(id);
      toast('Collection deleted');
      navigate('/collections');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

  if (!id) return null;

  return (
    <div className="content">
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: 'var(--accent)' }} />
              Collection
            </div>
            <div className="view-title">
              <h1 className="ser">{col?.name ?? (loading ? 'Loading…' : 'Collection')}</h1>
            </div>
            {col && (
              <p className="view-sub">
                {col.itemCount} items · updated {timeAgo(col.updatedAt)}
                {col.description ? ` · ${col.description}` : ''}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-soft" onClick={() => setEditing(true)} disabled={!col}>
              <Icon id="i-gear" /> Edit
            </button>
            <button className="btn btn-soft" onClick={() => setUploadOpen(true)}>
              <Icon id="i-upload" /> Upload
            </button>
            <button className="btn btn-soft" onClick={() => setNoteEditing(true)}>
              <Icon id="i-doc" /> New note
            </button>
            <button className="btn btn-primary" onClick={() => setPicking(true)}>
              <Icon id="i-spark" /> Generate
            </button>
          </div>
        </div>
      </div>

      {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}

      {col && (
        <div className="seg" style={{ width: 'fit-content', marginBottom: 18 }}>
          <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
            <Icon id="i-folder" /> Files
          </button>
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            <Icon id="i-chat" /> Chat
          </button>
        </div>
      )}

      {col && tab === 'chat' && (
        <CorpusChat
          scope={{ collectionId: id }}
          title={`Chat with “${col.name}”`}
          subtitle={`Answers are grounded in this collection's ${col.itemCount} items, with citations.`}
          placeholder="Ask about this collection…"
        />
      )}

      {tab === 'files' && col && col.files.length === 0 && !loading && (
        <div className="empty">
          <Icon id="i-folder" />
          <p>No files yet. Upload something to get started.</p>
        </div>
      )}

      {tab === 'files' && col && col.files.length > 0 && (
        <div className="files">
          {col.files.map((f) => {
            const face = describe(f.kind, f.mimeType, f.title);
            return (
              <div
                key={f.id}
                className="file-row"
                style={{ '--tc': face.color } as React.CSSProperties}
                onClick={() => setOpen(fileToItem(f))}
              >
                <span className="f-ic">
                  <Icon id={face.icon} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="f-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.title}
                  </div>
                  <div className="f-sub">{face.label}</div>
                </div>
                <div className="f-col">{fmtSize(f.sizeBytes)}</div>
                <div className="f-col">{new Date(f.createdAt).toLocaleDateString()}</div>
                <div className="f-col">
                  <span className="prov p-personal">
                    <Icon id="i-folder" /> Collection
                  </span>
                </div>
                <button
                  className="icon-btn"
                  title="View / actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(fileToItem(f));
                  }}
                >
                  <Icon id="i-more" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div style={{ marginTop: 26 }}>
          <button className="act del" onClick={handleDelete}>
            <Icon id="i-trash" /> Delete collection
          </button>
        </div>
      )}

      {uploadOpen && (
        <UploadDrawer
          collectionId={id}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            void reload();
          }}
        />
      )}

      {open && (
        <ItemModal
          item={open}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null);
            void reload();
          }}
        />
      )}

      {noteEditing && (
        <MarkdownEditor
          collectionId={id}
          onClose={() => setNoteEditing(false)}
          onSaved={() => {
            setNoteEditing(false);
            void reload();
          }}
        />
      )}

      {picking && (
        <TypePicker
          onClose={() => setPicking(false)}
          onPick={(key) => {
            setPicking(false);
            if (key === 'note') setNoteEditing(true);
            // Documents are uploaded Word files, not a generated type.
            else if (key === 'doc') setUploadOpen(true);
            else if (key === 'quiz' || key === 'flash' || key === 'mind') setChooseType(key);
            else if (key === 'diagram') setBuildType(key);
            // Remaining generatable types (audio/report/video/infographic/
            // slides/data table): generate from the collection's files.
            else if (TYPE[key].generate) setGenFromType(key);
          }}
        />
      )}
      {chooseType && (
        <CreateChooser
          typeKey={chooseType}
          onClose={() => setChooseType(null)}
          onUpload={() => {
            setChooseType(null);
            setUploadOpen(true);
          }}
          onGenerate={() => {
            const k = chooseType;
            setChooseType(null);
            // Generate from the collection's own files, not a new source.
            setGenFromType(k);
          }}
          onBuild={() => {
            const k = chooseType;
            setChooseType(null);
            setBuildType(k);
          }}
        />
      )}

      {buildType === 'quiz' && (
        <QuizEditor
          collectionId={id}
          onClose={() => setBuildType(null)}
          onSaved={() => {
            setBuildType(null);
            void reload();
          }}
        />
      )}
      {buildType === 'flash' && (
        <FlashcardsEditor
          collectionId={id}
          onClose={() => setBuildType(null)}
          onSaved={() => {
            setBuildType(null);
            void reload();
          }}
        />
      )}
      {buildType === 'mind' && (
        <MindmapEditor
          collectionId={id}
          onClose={() => setBuildType(null)}
          onSaved={() => {
            setBuildType(null);
            void reload();
          }}
        />
      )}
      {buildType === 'diagram' && (
        <DiagramEditor
          collectionId={id}
          onClose={() => setBuildType(null)}
          onSaved={() => {
            setBuildType(null);
            void reload();
          }}
        />
      )}

      {genFromType && col && (
        <GenerateFromCollectionDrawer
          typeKey={genFromType}
          collectionId={id}
          files={col.files}
          onClose={() => setGenFromType(null)}
          onDone={() => void reload()}
        />
      )}

      {editing && col && (
        <EditCollectionModal
          id={id}
          current={col}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function EditCollectionModal({
  id,
  current,
  onClose,
  onSaved,
}: {
  id: string;
  current: CollectionDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(current.name);
  const [description, setDescription] = useState(current.description ?? '');
  const [tags, setTags] = useState(current.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateCollection(id, {
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast('Collection updated');
      onSaved();
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
                <div className="m-type">Edit collection</div>
                <h2>Edit collection</h2>
                <p className="m-desc">Rename, re-describe, or re-tag this collection.</p>
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
                  {busy ? 'Saving…' : 'Save changes'}
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
