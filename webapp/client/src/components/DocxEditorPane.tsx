/**
 * In-app Word (.docx) editor — wraps @eigenpal/docx-editor-react (ProseMirror
 * + OOXML round-trip) around our corpus artifacts. Loads the document bytes
 * from the same-origin /file route, edits in place, and saves by re-uploading
 * the serialized .docx via PUT /api/corpus/artifacts/:id/docx (which also
 * re-extracts + re-embeds so search/chat stay in sync with the edits).
 *
 * Heavy dependency — always load this module lazily (React.lazy) so the main
 * bundle stays lean.
 */
import { useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import '@eigenpal/docx-editor-react/styles.css';
import { Icon } from './Icon';
import { artifactFileUrl, updateArtifactDocx } from '../lib/artifacts';
import { toast } from '../lib/toast';

export default function DocxEditorPane({
  id,
  title,
  onSaved,
}: {
  id: string;
  title: string;
  /** Called after a successful save so the parent can refresh its preview. */
  onSaved?: () => void;
}) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<DocxEditorRef>(null);

  useEffect(() => {
    let cancelled = false;
    setBuffer(null);
    setError(null);
    fetch(artifactFileUrl(id))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load document (HTTP ${res.status})`);
        return res.arrayBuffer();
      })
      .then((buf) => !cancelled && setBuffer(buf))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function upload(data: ArrayBuffer) {
    setSaving(true);
    try {
      const r = await updateArtifactDocx(id, data, `${title || 'document'}.docx`);
      toast(
        r.embedSkipped
          ? 'Saved — not re-indexed (embedding failed; backfill in Settings → Diagnose)'
          : 'Saved to library',
      );
      onSaved?.();
    } catch (e) {
      toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (saving) return;
    const data = await editorRef.current?.save();
    if (!data) {
      toast('Nothing to save yet — the document is still loading.');
      return;
    }
    await upload(data);
  }

  if (error) {
    return (
      <div className="empty" style={{ color: 'var(--accent)' }}>
        {error}
      </div>
    );
  }
  if (!buffer) {
    return <div className="empty">Loading document…</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <DocxEditor
        ref={editorRef}
        documentBuffer={buffer}
        mode="editing"
        documentName={title}
        documentNameEditable={false}
        onSave={(data) => void upload(data)}
        onError={(e) => setError(e.message)}
        style={{ flex: 1, minHeight: 0 }}
        toolbarExtra={
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void save()}
            style={{ marginLeft: 8 }}
          >
            <Icon id="i-upload" />
            {saving ? 'Saving…' : 'Save to library'}
          </button>
        }
      />
    </div>
  );
}
