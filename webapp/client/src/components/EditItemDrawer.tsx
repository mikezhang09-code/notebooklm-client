/**
 * Edit-details drawer — rename an artifact, change its file type (kind), edit a
 * free-text description, and adjust tags. Patches PATCH /api/corpus/artifacts/:id.
 * Used for collection + free-form artifacts (not NotebookLM-sourced ones).
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { UPLOAD_KIND_OPTIONS } from '../lib/registry';
import { getArtifactEdit, updateArtifact } from '../lib/artifacts';
import { toast } from '../lib/toast';

export default function EditItemDrawer({
  id,
  tc = 'var(--accent)',
  onClose,
  onSaved,
}: {
  id: string;
  tc?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('upload');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A successful save calls onSaved(), which unmounts this drawer; guard the
  // post-await state updates so they don't run on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    let live = true;
    getArtifactEdit(id)
      .then((s) => {
        if (!live) return;
        setTitle(s.title);
        setKind(s.kind);
        setDescription(s.description);
        setTags(s.tags.join(', '));
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id]);

  // The stored kind may be something not in the picker (e.g. 'qa'); keep it as
  // an option so saving doesn't silently retype the artifact.
  const kindOptions = UPLOAD_KIND_OPTIONS.some((o) => o.value === kind)
    ? UPLOAD_KIND_OPTIONS
    : [{ value: kind, label: kind }, ...UPLOAD_KIND_OPTIONS];

  async function save() {
    if (!title.trim()) {
      toast('Give it a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateArtifact(id, {
        title: title.trim(),
        kind,
        description: description.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast('Saved');
      onSaved();
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    }
  }

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer open" style={{ '--tc': tc } as React.CSSProperties}>
        <div className="drawer-head">
          <span className="d-ic">
            <Icon id="i-doc" />
          </span>
          <div className="d-tt">
            <b>Edit details</b>
            <small>Name, type, description &amp; tags</small>
          </div>
          <button className="icon-btn x" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="drawer-body">
          {loading ? (
            <p className="hint">Loading…</p>
          ) : (
            <>
              <div className="field">
                <label>Name</label>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Display name"
                />
              </div>
              <div className="field">
                <label>Type</label>
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {kindOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <textarea
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this is about…"
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
              {error && <p className="hint" style={{ color: 'var(--accent)' }}>{error}</p>}
            </>
          )}
        </div>
        <div className="drawer-foot">
          <button className="btn btn-primary" disabled={busy || loading} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn btn-soft" onClick={onClose}>
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}
