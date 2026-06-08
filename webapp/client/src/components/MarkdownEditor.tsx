/**
 * Markdown note editor — write a note in Markdown with live preview and save it
 * to the library as a `note` artifact (free-form, or into a collection).
 * Reuses the corpus ingest pipeline so notes are searchable + viewable like any
 * other artifact.
 */
import { useMemo, useState } from 'react';
import { marked } from 'marked';
import { Icon } from './Icon';
import { apiFormData } from '../lib/api';
import { updateArtifactContent } from '../lib/artifacts';
import { toast } from '../lib/toast';

type View = 'write' | 'split' | 'preview';

export default function MarkdownEditor({
  collectionId,
  editId,
  initialTitle,
  initialMarkdown,
  onClose,
  onSaved,
}: {
  collectionId?: string;
  /** When set, save updates this existing artifact instead of creating a note. */
  editId?: string;
  initialTitle?: string;
  initialMarkdown?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [md, setMd] = useState(initialMarkdown ?? '# New note\n\nWrite anything in **Markdown**…\n');
  const [view, setView] = useState<View>('split');
  const [busy, setBusy] = useState(false);

  const html = useMemo(() => {
    try {
      return marked.parse(md, { async: false }) as string;
    } catch {
      return '';
    }
  }, [md]);

  async function save() {
    const name = title.trim();
    if (!name) {
      toast('Give your note a title');
      return;
    }
    setBusy(true);
    try {
      if (editId) {
        const r = await updateArtifactContent(editId, { markdown: md, title: name });
        toast(r.embedSkipped ? 'Saved — not re-indexed (embedding failed; backfill in Settings → Diagnose)' : 'Saved');
        onSaved();
        return;
      }
      const file = new File([md], `${name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 96)}.md`, {
        type: 'text/markdown',
      });
      const form = new FormData();
      form.append('file', file);
      form.append('title', name.slice(0, 512));
      form.append('kind', 'note');
      form.append('origin', 'upload');
      if (collectionId) form.append('collectionId', collectionId);
      const r = await apiFormData<{ embedSkipped?: boolean }>('/api/corpus/ingest', form);
      toast(
        r.embedSkipped
          ? 'Note saved — not indexed for search (embedding failed; backfill in Settings → Diagnose)'
          : collectionId
            ? 'Note saved to collection'
            : 'Note saved',
      );
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-root show" style={{ '--tc': '#6d8a96', padding: 24 } as React.CSSProperties}>
      <div
        style={{
          width: '92vw',
          maxWidth: 1100,
          height: '88vh',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="t-ic" style={{ width: 34, height: 34 }}>
            <Icon id="i-doc" />
          </span>
          <input
            className="input"
            style={{ flex: 1, fontWeight: 600 }}
            placeholder="Note title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="seg" style={{ width: 220 }}>
            {(['write', 'split', 'preview'] as const).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'write' ? 'Write' : v === 'split' ? 'Split' : 'Preview'}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : editId ? 'Save' : 'Save note'}
          </button>
          <button className="icon-btn" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {view !== 'preview' && (
            <textarea
              value={md}
              onChange={(e) => setMd(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                border: 0,
                outline: 0,
                resize: 'none',
                padding: '20px 24px',
                background: 'var(--card-2)',
                color: 'var(--ink)',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 13.5,
                lineHeight: 1.7,
                borderRight: view === 'split' ? '1px solid var(--line)' : undefined,
              }}
            />
          )}
          {view !== 'write' && (
            <div
              className="md-body"
              style={{ flex: 1, overflow: 'auto', padding: '24px 30px' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
