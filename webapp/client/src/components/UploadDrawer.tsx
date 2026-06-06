/**
 * Upload drawer — store one or more files in the corpus via POST
 * /api/corpus/ingest. Optional `collectionId` files them under a collection;
 * otherwise they're free-form. Each file defaults to the best-fit type (kind)
 * detected from its MIME/extension; the user can rename and re-type per file.
 */
import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { apiFormData } from '../lib/api';
import { TYPE, UPLOAD_KIND_OPTIONS, detectIngestKind, type TypeKey } from '../lib/registry';
import { toast } from '../lib/toast';

type Status = 'pending' | 'uploading' | 'done' | 'error';

interface PendingFile {
  file: File;
  name: string;
  kind: string;
  status: Status;
  error?: string;
}

export default function UploadDrawer({
  typeKey,
  collectionId,
  onClose,
  onUploaded,
}: {
  typeKey?: TypeKey;
  collectionId?: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  // Tint the drawer by the launching section's color, falling back to accent.
  const tc = typeKey ? TYPE[typeKey].color : 'var(--accent)';
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added: PendingFile[] = Array.from(list).map((file) => ({
      file,
      name: file.name.replace(/\.[^.]+$/, ''),
      kind: detectIngestKind(file.type, file.name),
      status: 'pending',
    }));
    setFiles((prev) => [...prev, ...added]);
  }

  function patch(idx: number, p: Partial<PendingFile>) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...p } : f)));
  }

  function remove(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const pendingCount = files.filter((f) => f.status !== 'done').length;

  async function submit() {
    if (pendingCount === 0) return;
    setBusy(true);
    let okCount = 0;
    let skipped = false;
    // Sequential upload keeps memory bounded and gives clear per-file status.
    for (let i = 0; i < files.length; i++) {
      if (files[i]!.status === 'done') continue;
      patch(i, { status: 'uploading', error: undefined });
      try {
        const pf = files[i]!;
        const form = new FormData();
        form.append('file', pf.file);
        form.append('title', (pf.name.trim() || pf.file.name).slice(0, 512));
        form.append('kind', pf.kind);
        form.append('origin', 'upload');
        if (collectionId) form.append('collectionId', collectionId);
        const r = await apiFormData<{ embedSkipped?: boolean }>('/api/corpus/ingest', form);
        if (r.embedSkipped) skipped = true;
        okCount++;
        patch(i, { status: 'done' });
      } catch (err) {
        patch(i, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy(false);

    if (okCount > 0) {
      const where = collectionId ? ' to collection' : '';
      toast(
        skipped
          ? `Uploaded ${okCount} file${okCount === 1 ? '' : 's'}${where} — some not indexed (embedding quota exceeded)`
          : `Uploaded ${okCount} file${okCount === 1 ? '' : 's'}${where}`,
      );
      onUploaded();
    }
    // If any failed, the drawer stays open so the user can retry just those.
  }

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': tc } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-upload" />
          </span>
          <div className="d-tt">
            <b>Upload files</b>
            <small>{collectionId ? 'Into this collection' : 'Free-form upload'}</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="field">
            <label>Files</label>
            <button
              className="dropzone"
              style={{ width: '100%' }}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <Icon id="i-upload" />
              <div style={{ marginTop: 8 }}>
                {files.length > 0 ? 'Add more files…' : 'Click or drop files here'}
              </div>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {files.map((f, i) => (
            <div
              key={i}
              className="field"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: 12,
                gap: 8,
                opacity: f.status === 'done' ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.file.name}
                </span>
                {f.status === 'done' && <span style={{ fontSize: 12, color: 'var(--ok, #5f8a5a)' }}>✓ Uploaded</span>}
                {f.status === 'uploading' && <span style={{ fontSize: 12 }}>Uploading…</span>}
                {f.status !== 'uploading' && f.status !== 'done' && (
                  <button className="icon-btn x" title="Remove" onClick={() => remove(i)}>
                    <Icon id="i-close" />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={f.name}
                  placeholder="Display name"
                  disabled={f.status === 'done' || f.status === 'uploading'}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                <select
                  className="input"
                  style={{ width: 140 }}
                  value={f.kind}
                  disabled={f.status === 'done' || f.status === 'uploading'}
                  onChange={(e) => patch(i, { kind: e.target.value })}
                >
                  {UPLOAD_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {f.error && <p className="hint" style={{ color: 'var(--accent)', margin: 0 }}>{f.error}</p>}
            </div>
          ))}
        </div>
        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || pendingCount === 0} onClick={submit}>
            {busy
              ? 'Uploading…'
              : pendingCount > 1
                ? `Upload ${pendingCount} files`
                : 'Upload'}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            {files.some((f) => f.status === 'done') ? 'Done' : 'Cancel'}
          </button>
        </div>
      </aside>
    </>
  );
}
