/**
 * Markdown note editor — write a note in Markdown with a formatting toolbar,
 * keyboard shortcuts, smart list/quote continuation, and a live (debounced)
 * preview that renders Mermaid / code / math like the artifact viewer. Saves to
 * the library as a `note` artifact (free-form, or into a collection), reusing
 * the corpus ingest pipeline so notes are searchable + viewable like any other.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MarkdownView } from '../lib/markdown';
import {
  wrapInline,
  toggleLinePrefix,
  toggleOrderedList,
  insertLink,
  insertBlock,
  handleEnter,
  indent,
  type EditState,
} from '../lib/editor-commands';
import { Icon } from './Icon';
import { apiFormData } from '../lib/api';
import { updateArtifactContent } from '../lib/artifacts';
import { toast } from '../lib/toast';

type View = 'write' | 'split' | 'preview';

const DEFAULT_MD = '# New note\n\nWrite anything in **Markdown**…\n';
const TABLE_SNIPPET = '| Column A | Column B |\n| --- | --- |\n| Cell | Cell |';
const CODE_SNIPPET = '```\ncode\n```';
const MERMAID_SNIPPET = '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```';

/** Debounce a value so the preview doesn't re-render (and re-run Mermaid) on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

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
  const [md, setMd] = useState(initialMarkdown ?? DEFAULT_MD);
  const [view, setView] = useState<View>('split');
  const [busy, setBusy] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  // Baseline for the unsaved-changes guard; advances on a successful save.
  const saved = useRef({ title: initialTitle ?? '', md: initialMarkdown ?? DEFAULT_MD });
  const dirty = title !== saved.current.title || md !== saved.current.md;

  const previewSrc = useDebounced(md, 250);

  // Re-apply a command's intended selection after the controlled value updates.
  useLayoutEffect(() => {
    if (pendingSel.current && taRef.current) {
      const [a, b] = pendingSel.current;
      taRef.current.focus();
      taRef.current.setSelectionRange(a, b);
      pendingSel.current = null;
    }
  }, [md]);

  // Warn before a full-page unload (refresh/close) while there are edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function requestClose() {
    if (busy) return; // don't tear down mid-save
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  // Escape closes (with the unsaved guard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Run a pure command against the live selection and stage its result. */
  function runCmd(fn: (s: EditState) => EditState | null) {
    const ta = taRef.current;
    if (!ta) return;
    const next = fn({ text: md, selStart: ta.selectionStart, selEnd: ta.selectionEnd });
    if (!next) return;
    pendingSel.current = [next.selStart, next.selEnd];
    setMd(next.text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'b') {
      e.preventDefault();
      runCmd((s) => wrapInline(s, '**', 'bold text'));
    } else if (mod && key === 'i') {
      e.preventDefault();
      runCmd((s) => wrapInline(s, '*', 'italic text'));
    } else if (mod && key === 'k') {
      e.preventDefault();
      runCmd(insertLink);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      runCmd((s) => indent(s, e.shiftKey));
    } else if (e.key === 'Enter' && !e.shiftKey) {
      const ta = e.currentTarget;
      const next = handleEnter({ text: md, selStart: ta.selectionStart, selEnd: ta.selectionEnd });
      if (next) {
        e.preventDefault();
        pendingSel.current = [next.selStart, next.selEnd];
        setMd(next.text);
      }
    }
  }

  // Proportionally sync the preview to the editor's scroll position (split view).
  function syncScroll() {
    const ta = taRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    const denom = ta.scrollHeight - ta.clientHeight;
    const ratio = denom > 0 ? ta.scrollTop / denom : 0;
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
  }

  const counts = useMemo(() => {
    const words = md.trim() ? md.trim().split(/\s+/).length : 0;
    return { words, chars: md.length };
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
        saved.current = { title: name, md };
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
      saved.current = { title: name, md };
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

  // Toolbar entries: text label or an icon id, plus the command to run.
  const tools: ({ key: string; title: string; run: () => void } & ({ label: string } | { icon: string }))[] = [
    { key: 'bold', title: 'Bold (Ctrl/Cmd+B)', label: 'B', run: () => runCmd((s) => wrapInline(s, '**', 'bold text')) },
    { key: 'italic', title: 'Italic (Ctrl/Cmd+I)', label: 'I', run: () => runCmd((s) => wrapInline(s, '*', 'italic text')) },
    { key: 'code', title: 'Inline code', label: '</>', run: () => runCmd((s) => wrapInline(s, '`', 'code')) },
    { key: 'h', title: 'Heading', label: 'H', run: () => runCmd((s) => toggleLinePrefix(s, '## ')) },
    { key: 'ul', title: 'Bulleted list', label: '•', run: () => runCmd((s) => toggleLinePrefix(s, '- ')) },
    { key: 'ol', title: 'Numbered list', label: '1.', run: () => runCmd(toggleOrderedList) },
    { key: 'quote', title: 'Quote', label: '❝', run: () => runCmd((s) => toggleLinePrefix(s, '> ')) },
    { key: 'link', title: 'Link (Ctrl/Cmd+K)', icon: 'i-link', run: () => runCmd(insertLink) },
    { key: 'codeblock', title: 'Code block', label: '{ }', run: () => runCmd((s) => insertBlock(s, CODE_SNIPPET)) },
    { key: 'table', title: 'Table', icon: 'i-table', run: () => runCmd((s) => insertBlock(s, TABLE_SNIPPET)) },
    { key: 'mermaid', title: 'Mermaid diagram', icon: 'i-mind', run: () => runCmd((s) => insertBlock(s, MERMAID_SNIPPET)) },
  ];

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
          {/* Disabled while clean so an unchanged edit can't trigger a pointless re-ingest/re-embed. */}
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
            {busy ? 'Saving…' : editId ? 'Save' : 'Save note'}
          </button>
          <button className="icon-btn" onClick={requestClose}>
            <Icon id="i-close" />
          </button>
        </div>

        {view !== 'preview' && (
          <div className="md-toolbar">
            {tools.map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.title}
                // Keep textarea focus/selection: prevent the button from stealing it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={t.run}
              >
                {'icon' in t ? <Icon id={t.icon} /> : <span className={`md-tool-${t.key}`}>{t.label}</span>}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {view !== 'preview' && (
            <textarea
              ref={taRef}
              value={md}
              onChange={(e) => setMd(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={view === 'split' ? syncScroll : undefined}
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
            <MarkdownView
              ref={previewRef}
              source={previewSrc}
              style={{ flex: 1, overflow: 'auto', padding: '24px 30px' }}
            />
          )}
        </div>

        <div className="md-statusbar">
          <span>{counts.words} words · {counts.chars} chars</span>
          {dirty && <span className="md-dirty">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}
