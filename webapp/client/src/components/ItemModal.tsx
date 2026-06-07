/**
 * Item detail modal — type-colored cover + key/value facts + actions
 * (Open / Download / Share / Delete). Fetches a fresh PAR download URL.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { describe, SOURCES } from '../lib/registry';
import { getDownloadUrl, deleteItem, shareItem, getRawText, isEditable, type Item } from '../lib/artifacts';
import { toast } from '../lib/toast';
import Viewer from './Viewer';
import CorpusChat from './CorpusChat';
import MarkdownEditor from './MarkdownEditor';
import EditItemDrawer from './EditItemDrawer';

function fmtSize(b: number | null): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function ItemModal({
  item,
  onClose,
  onDeleted,
}: {
  item: Item;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const t = describe(item.kind, item.mimeType, item.title);
  const src = SOURCES[item.provenance];
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const editable = isEditable(item);
  // NotebookLM-sourced artifacts are managed upstream — details aren't editable.
  const detailsEditable = item.provenance !== 'notebooklm';

  async function handleEdit() {
    try {
      const { content } = await getRawText(item.id);
      setEditContent(content);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    getDownloadUrl(item.id).then(setDownloadUrl).catch(() => setDownloadUrl(undefined));
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleDelete() {
    if (!confirm(`Delete "${item.title}"? This removes it from the library.`)) return;
    setBusy(true);
    try {
      await deleteItem(item.id);
      toast('Deleted');
      onDeleted?.();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    try {
      const url = await shareItem(item.id);
      await navigator.clipboard.writeText(url).catch(() => {});
      toast('Share link copied');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="modal-root show"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ '--tc': t.color } as React.CSSProperties}
    >
      <div className="modal">
        <div className="modal-cover">
          <div className="pat" />
          <span className="big">
            <Icon id={t.icon} />
          </span>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="m-type">{t.label}</div>
          <h2>{item.title}</h2>
          <span className={`prov p-${item.provenance}`} style={{ marginTop: 12, display: 'inline-flex' }}>
            <Icon id={src.icon} /> {src.label}
          </span>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{t.label}</dd>
            <dt>Source</dt>
            <dd>{src.label}</dd>
            <dt>From</dt>
            <dd>{item.from ?? '—'}</dd>
            {item.description && (
              <>
                <dt>Description</dt>
                <dd>{item.description}</dd>
              </>
            )}
            <dt>Created</dt>
            <dd>{new Date(item.createdAt).toLocaleString()}</dd>
            <dt>Size</dt>
            <dd>{fmtSize(item.sizeBytes)}</dd>
          </dl>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={() => setViewing(true)}>
            <Icon id="i-grid" /> View
          </button>
          <button className="btn btn-soft" onClick={() => setChatting(true)}>
            <Icon id="i-chat" /> Ask
          </button>
          {editable && (
            <button className="btn btn-soft" onClick={handleEdit}>
              <Icon id="i-doc" /> Edit
            </button>
          )}
          {detailsEditable && (
            <button className="btn btn-soft" onClick={() => setEditingDetails(true)}>
              <Icon id="i-gear" /> Details
            </button>
          )}
          <a
            className="btn btn-soft"
            href={downloadUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => !downloadUrl && e.preventDefault()}
          >
            <Icon id="i-ext" /> Open
          </a>
          <a
            className="btn btn-soft"
            href={downloadUrl ?? '#'}
            download
            onClick={(e) => !downloadUrl && e.preventDefault()}
          >
            <Icon id="i-download" /> Download
          </a>
          <button className="btn btn-soft" onClick={handleShare}>
            <Icon id="i-share" /> Share
          </button>
          {onDeleted && (
            <button
              className="btn btn-soft"
              style={{ marginLeft: 'auto', color: 'var(--accent)' }}
              disabled={busy}
              onClick={handleDelete}
            >
              <Icon id="i-trash" /> Delete
            </button>
          )}
        </div>
      </div>

      {viewing && <Viewer id={item.id} title={item.title} tc={t.color} onClose={() => setViewing(false)} />}

      {chatting && (
        <div
          className="modal-root show"
          style={{ '--tc': t.color, padding: 24 } as React.CSSProperties}
          onClick={(e) => e.target === e.currentTarget && setChatting(false)}
        >
          <div
            style={{
              width: '92vw',
              maxWidth: 860,
              height: '84vh',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 16,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 18px',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span className="t-ic" style={{ width: 34, height: 34 }}>
                <Icon id={t.icon} />
              </span>
              <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Ask · {item.title}
              </b>
              <button className="icon-btn" onClick={() => setChatting(false)}>
                <Icon id="i-close" />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 20px 18px' }}>
              <CorpusChat
                scope={{ artifactId: item.id }}
                title={`Chat with “${item.title}”`}
                subtitle="Answers are grounded in this document, with citations."
                placeholder="Ask about this document…"
                accent={t.color}
              />
            </div>
          </div>
        </div>
      )}

      {editingDetails && (
        <EditItemDrawer
          id={item.id}
          tc={t.color}
          onClose={() => setEditingDetails(false)}
          onSaved={() => {
            setEditingDetails(false);
            onDeleted?.();
            onClose();
          }}
        />
      )}

      {editContent !== null && (
        <MarkdownEditor
          editId={item.id}
          initialTitle={item.title}
          initialMarkdown={editContent}
          onClose={() => setEditContent(null)}
          onSaved={() => {
            setEditContent(null);
            onDeleted?.();
            onClose();
          }}
        />
      )}
    </div>
  );
}
