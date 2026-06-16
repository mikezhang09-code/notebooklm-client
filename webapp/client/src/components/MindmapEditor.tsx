/**
 * Mind-map editor — build or edit a mind map visually (no JSON typing): click a
 * node to select, double-click / F2 to rename, Tab adds a child, Enter a
 * sibling, Del removes, Alt+↑/↓ reorders, with undo/redo. Saves a `mind`
 * artifact: a new free-form file, into a collection, or overwriting an existing
 * one on edit. Ported from the research-corpus portal's MindMapEditorModal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { getRawText } from '../lib/artifacts';
import { toast } from '../lib/toast';
import {
  MM_BORDERS,
  MM_FILLS,
  MM_NH,
  MM_NW,
  MM_TEXTS,
  buildMindLayout,
  mindAddChild,
  mindAddSiblingAfter,
  mindCountDescendants,
  mindFindNode,
  mindFindParent,
  mindMoveSibling,
  mindRemoveNode,
  mindUpdateName,
  newMindNode,
  saveStudyArtifact,
  seedMindRoot,
  serializeMind,
  toMindEditNode,
  type MindEditNode,
  type RawMindNode,
} from '../lib/study';

export default function MindmapEditor({
  editId,
  collectionId,
  initialTitle,
  tc = '#5b6bbf',
  onClose,
  onSaved,
}: {
  editId?: string;
  collectionId?: string;
  initialTitle?: string;
  tc?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editId;
  const [title, setTitle] = useState(initialTitle ?? '');
  const [root, setRoot] = useState<MindEditNode | null>(isEdit ? null : seedMindRoot());
  const [initialJson, setInitialJson] = useState<string | null>(isEdit ? null : serializeMind(seedMindRoot()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<MindEditNode[]>([]);
  const [redoStack, setRedoStack] = useState<MindEditNode[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    getRawText(editId)
      .then(({ content }) => {
        if (cancelled) return;
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Not a mind map: expected a JSON object with name/children');
        }
        const tree = toMindEditNode(parsed as RawMindNode);
        setInitialJson(serializeMind(tree));
        setRoot(tree);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const layout = useMemo(() => (root ? buildMindLayout(root, collapsed) : null), [root, collapsed]);

  const dirty =
    root !== null &&
    (isEdit
      ? title.trim() !== (initialTitle ?? '') || serializeMind(root) !== initialJson
      : title.trim().length > 0 || serializeMind(root) !== initialJson);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  // ---- mutation plumbing: every edit goes through apply() for undo ----
  function apply(next: MindEditNode) {
    if (!root) return;
    setUndoStack((s) => [...s.slice(-99), root]);
    setRedoStack([]);
    setRoot(next);
  }
  function undo() {
    if (!root || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, root]);
    setRoot(prev);
    setEditingId(null);
  }
  function redo() {
    if (!root || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, root]);
    setRoot(next);
    setEditingId(null);
  }

  function startRename(id: string) {
    if (!root) return;
    const node = mindFindNode(root, id);
    if (!node) return;
    setSelectedId(id);
    setEditingId(id);
    setEditText(node.name);
  }
  function commitRename() {
    if (!root || !editingId) return;
    const name = editText.trim() || 'Untitled';
    const node = mindFindNode(root, editingId);
    if (node && node.name !== name) apply(mindUpdateName(root, editingId, name));
    setEditingId(null);
  }
  function handleAddChild(parentId: string) {
    if (!root) return;
    const child = newMindNode();
    apply(mindAddChild(root, parentId, child));
    setCollapsed((prev) => {
      if (!prev.has(parentId)) return prev;
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
    setSelectedId(child.id);
    setEditingId(child.id);
    setEditText(child.name);
  }
  function handleAddSibling(id: string) {
    if (!root) return;
    if (id === root.id) {
      handleAddChild(id);
      return;
    }
    const sibling = newMindNode();
    apply(mindAddSiblingAfter(root, id, sibling));
    setSelectedId(sibling.id);
    setEditingId(sibling.id);
    setEditText(sibling.name);
  }
  function handleDelete(id: string) {
    if (!root || id === root.id) return;
    const node = mindFindNode(root, id);
    if (!node) return;
    const n = mindCountDescendants(node);
    if (n > 0 && !window.confirm(`Delete this topic and its ${n} subtopic${n !== 1 ? 's' : ''}?`)) return;
    const parent = mindFindParent(root, id);
    apply(mindRemoveNode(root, id));
    setSelectedId(parent?.id ?? null);
    if (editingId === id) setEditingId(null);
  }
  function handleMove(id: string, dir: -1 | 1) {
    if (!root || id === root.id) return;
    apply(mindMoveSibling(root, id, dir));
  }
  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- keyboard shortcuts (canvas-level; inputs handle their own keys) ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!root || saving) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape' && !editingId) requestClose();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (!selectedId) return;
      const node = mindFindNode(root, selectedId);
      if (!node) return;
      const parent = mindFindParent(root, selectedId);
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          handleAddChild(selectedId);
          break;
        case 'Enter':
          e.preventDefault();
          handleAddSibling(selectedId);
          break;
        case 'F2':
          e.preventDefault();
          startRename(selectedId);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          handleDelete(selectedId);
          break;
        case ' ':
          e.preventDefault();
          if (node.children.length) toggleCollapse(selectedId);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (parent) setSelectedId(parent.id);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (node.children.length) {
            setCollapsed((prev) => {
              if (!prev.has(selectedId)) return prev;
              const next = new Set(prev);
              next.delete(selectedId);
              return next;
            });
            setSelectedId(node.children[0]!.id);
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? -1 : 1;
          if (e.altKey) {
            handleMove(selectedId, dir as -1 | 1);
            break;
          }
          if (!parent) break;
          const idx = parent.children.findIndex((c) => c.id === selectedId);
          const next = parent.children[idx + dir];
          if (next) setSelectedId(next.id);
          break;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  async function handleSave() {
    const t = title.trim();
    if (!t) {
      setError('Title is required');
      return;
    }
    if (!root) return;
    if (editingId) commitRename();
    setSaving(true);
    setError(null);
    try {
      await saveStudyArtifact({ editId, collectionId, kind: 'mind', title: t, json: serializeMind(root) });
      toast(isEdit ? 'Mind map saved' : collectionId ? 'Mind map saved to collection' : 'Mind map saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const selected = root && selectedId ? mindFindNode(root, selectedId) : null;
  const canEdit = !!selected && !saving;
  const selectionIsRoot = !!selected && !!root && selected.id === root.id;

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        style={{
          width: '94vw',
          maxWidth: 1180,
          height: '90vh',
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
            <Icon id="i-mind" />
          </span>
          <b style={{ flex: 1 }}>{isEdit ? 'Edit mind map' : 'New mind map'}</b>
          <button className="btn btn-primary" disabled={saving || loading || !root || !title.trim() || !dirty} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save mind map'}
          </button>
          <button className="icon-btn" onClick={requestClose} disabled={saving}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
          <input
            className="input"
            placeholder="Mind map title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            style={{ fontWeight: 600 }}
          />

          {/* Toolbar — acts on the selected node */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card-2)', padding: '5px 8px' }}>
            <ToolBtn label="Add child (Tab)" icon="i-plus" onClick={() => selectedId && handleAddChild(selectedId)} disabled={!canEdit} />
            <ToolBtn label="Add sibling (Enter)" icon="i-layers" onClick={() => selectedId && handleAddSibling(selectedId)} disabled={!canEdit || selectionIsRoot} />
            <ToolBtn label="Rename (F2 or double-click)" icon="i-doc" onClick={() => selectedId && startRename(selectedId)} disabled={!canEdit} />
            <ToolBtn label="Delete (Del)" icon="i-trash" onClick={() => selectedId && handleDelete(selectedId)} disabled={!canEdit || selectionIsRoot} danger />
            <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 6px' }} />
            <ToolBtn label="Move up (Alt+↑)" icon="i-chev" rotate={-90} onClick={() => selectedId && handleMove(selectedId, -1)} disabled={!canEdit || selectionIsRoot} />
            <ToolBtn label="Move down (Alt+↓)" icon="i-chev" rotate={90} onClick={() => selectedId && handleMove(selectedId, 1)} disabled={!canEdit || selectionIsRoot} />
            <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 6px' }} />
            <ToolBtn label="Undo (Ctrl+Z)" icon="i-back" onClick={undo} disabled={undoStack.length === 0 || saving} />
            <ToolBtn label="Redo (Ctrl+Shift+Z)" icon="i-chev" onClick={redo} disabled={redoStack.length === 0 || saving} />
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', paddingRight: 4 }} className="mm-hint">
              Tab child · Enter sibling · Dbl-click rename · Del delete
            </span>
          </div>

          {/* Canvas */}
          <div
            style={{ flex: 1, minHeight: 320, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card-2)', position: 'relative' }}
            onClick={() => {
              if (editingId) commitRename();
              setSelectedId(null);
            }}
          >
            {error && !root ? (
              <div className="empty" style={{ color: 'var(--accent)' }}>
                Failed to load: {error}
              </div>
            ) : loading || !layout || !root ? (
              <div className="empty">Loading…</div>
            ) : (
              <div style={{ width: layout.width, height: layout.height, position: 'relative' }}>
                <svg
                  style={{ position: 'absolute', top: 0, left: 0, width: layout.width, height: layout.height, pointerEvents: 'none', overflow: 'visible' }}
                >
                  {layout.edges.map((e, i) => {
                    const mx = (e.x1 + e.x2) / 2;
                    return (
                      <path key={i} d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}`} fill="none" stroke="#aab2dd" strokeWidth={1.6} />
                    );
                  })}
                </svg>

                {layout.nodes.map((n) => {
                  const isSelected = n.id === selectedId;
                  const isEditing = n.id === editingId;
                  const isCollapsed = collapsed.has(n.id);
                  const di = Math.min(n.depth, MM_FILLS.length - 1);
                  return (
                    <div
                      key={n.id}
                      style={{
                        position: 'absolute',
                        left: n.x,
                        top: n.y,
                        width: MM_NW,
                        height: MM_NH,
                        background: MM_FILLS[di],
                        color: MM_TEXTS[di],
                        border: `1px solid ${MM_BORDERS[di]}`,
                        borderRadius: 8,
                        padding: '0 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: n.depth === 0 ? 600 : 500,
                        boxShadow: isSelected ? `0 0 0 2px var(--bg), 0 0 0 4px ${tc}` : '1px 1px 0 rgba(42,36,24,0.1)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingId && editingId !== n.id) commitRename();
                        setSelectedId(n.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(n.id);
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          style={{ width: '100%', minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: 'inherit', font: 'inherit' }}
                          placeholder="Topic"
                        />
                      ) : (
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
                          {n.label}
                        </span>
                      )}
                      {n.hasChildren && !isEditing && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(n.id);
                          }}
                          style={{ display: 'inline-flex', transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .12s' }}
                        >
                          <Icon id="i-chev" />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && root && (
            <div className="hint" style={{ color: 'var(--accent)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  label,
  icon,
  onClick,
  disabled,
  danger,
  rotate,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  rotate?: number;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ color: danger ? 'var(--accent)' : undefined, transform: rotate ? `rotate(${rotate}deg)` : undefined }}
    >
      <Icon id={icon} />
    </button>
  );
}
