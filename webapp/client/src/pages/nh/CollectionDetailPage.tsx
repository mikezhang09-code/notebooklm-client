/**
 * Collection detail — files table + upload (real, files land in this collection
 * via POST /api/corpus/ingest?collectionId). Generate-from-collection is wired
 * in a later phase.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { TYPE, type TypeKey } from '../../lib/registry';
import { getCollection, deleteCollection, kindToTypeKey, timeAgo, type CollectionDetail } from '../../lib/collections';
import { apiFormData } from '../../lib/api';
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
            <button className="btn btn-soft" onClick={() => setUploadOpen(true)}>
              <Icon id="i-upload" /> Upload
            </button>
            <button
              className="btn btn-primary"
              onClick={() => toast('Generate-from-collection arrives in the next phase')}
            >
              <Icon id="i-spark" /> Generate
            </button>
          </div>
        </div>
      </div>

      {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}

      {col && col.files.length === 0 && !loading && (
        <div className="empty">
          <Icon id="i-folder" />
          <p>No files yet. Upload something to get started.</p>
        </div>
      )}

      {col && col.files.length > 0 && (
        <div className="files">
          {col.files.map((f) => {
            const t = TYPE[kindToTypeKey(f.kind) as TypeKey] ?? TYPE.report;
            return (
              <div
                key={f.id}
                className="file-row"
                style={{ '--tc': t.color } as React.CSSProperties}
              >
                <span className="f-ic">
                  <Icon id={t.icon} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="f-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.title}
                  </div>
                  <div className="f-sub">{t.label}</div>
                </div>
                <div className="f-col">{fmtSize(f.sizeBytes)}</div>
                <div className="f-col">{new Date(f.createdAt).toLocaleDateString()}</div>
                <div className="f-col">
                  <span className="prov p-personal">
                    <Icon id="i-folder" /> Collection
                  </span>
                </div>
                <button className="icon-btn" title="More" onClick={() => toast('Item actions arrive with the item modal')}>
                  <Icon id="i-more" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <button className="act del" onClick={handleDelete}>
          <Icon id="i-trash" /> Delete collection
        </button>
      </div>

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
    </div>
  );
}

function UploadDrawer({
  collectionId,
  onClose,
  onUploaded,
}: {
  collectionId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', (name.trim() || file.name).slice(0, 512));
      form.append('kind', 'upload');
      form.append('origin', 'upload');
      form.append('collectionId', collectionId);
      await apiFormData('/api/corpus/ingest', form);
      toast('Uploaded to collection');
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': 'var(--accent)' } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-upload" />
          </span>
          <div className="d-tt">
            <b>Upload to collection</b>
            <small>Stored + indexed for search</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <label>File</label>
            <button className="dropzone" style={{ width: '100%' }} onClick={() => inputRef.current?.click()}>
              <Icon id="i-upload" />
              <div style={{ marginTop: 8 }}>{file ? file.name : 'Click to choose a file'}</div>
            </button>
            <input
              ref={inputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
              }}
            />
          </div>
          <div className="field">
            <label>Name (optional)</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          </div>
          {error && <p className="hint" style={{ color: 'var(--accent)' }}>{error}</p>}
        </div>
        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || !file} onClick={submit}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}
