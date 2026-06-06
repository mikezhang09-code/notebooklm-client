/**
 * Upload drawer — stores a file in the corpus via POST /api/corpus/ingest.
 * Optional `collectionId` files it under a collection; otherwise it's free-form.
 */
import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { apiFormData } from '../lib/api';
import { TYPE, type TypeKey } from '../lib/registry';
import { toast } from '../lib/toast';

export default function UploadDrawer({
  typeKey = 'report',
  collectionId,
  onClose,
  onUploaded,
}: {
  typeKey?: TypeKey;
  collectionId?: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const t = TYPE[typeKey];
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
      form.append('kind', t.ingestKind);
      form.append('origin', 'upload');
      if (collectionId) form.append('collectionId', collectionId);
      const r = await apiFormData<{ embedSkipped?: boolean }>('/api/corpus/ingest', form);
      toast(
        r.embedSkipped
          ? 'Uploaded — stored but not indexed for search (embedding quota exceeded). Re-embed later.'
          : collectionId
            ? 'Uploaded to collection'
            : 'Uploaded',
      );
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
      <aside className="drawer open" style={{ '--tc': t.color } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-upload" />
          </span>
          <div className="d-tt">
            <b>Upload {t.label}</b>
            <small>{collectionId ? 'Into this collection' : 'Free-form upload'}</small>
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
            {busy ? 'Uploading…' : `Upload ${t.label}`}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}
