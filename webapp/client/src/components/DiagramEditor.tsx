/**
 * Diagram editor — author or edit a Mermaid diagram with a live preview and an
 * AI assistant (generate / revise from a natural-language prompt). Saves a
 * `diagram` artifact (.mmd): a new free-form file, into a collection, or
 * overwriting an existing one on edit. Ported from the research-corpus portal's
 * DiagramEditorModal, restyled and wired to this project's corpus API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { getRawText } from '../lib/artifacts';
import { renderMermaid } from '../lib/mermaid-render';
import { assistDiagram, saveAuthoredArtifact } from '../lib/study';
import { copyText } from '../lib/markdown-enhance';
import { toast } from '../lib/toast';

const STARTER = `flowchart TD
    A[Start] --> B{Decision?}
    B -->|yes| C[Do thing]
    B -->|no| D[Other thing]
    C --> E[End]
    D --> E`;

const TEMPLATES: { label: string; code: string }[] = [
  { label: 'Flowchart', code: STARTER },
  {
    label: 'Sequence',
    code: `sequenceDiagram
    participant U as User
    participant API
    participant DB
    U->>API: request
    API->>DB: query
    DB-->>API: rows
    API-->>U: response`,
  },
  {
    label: 'State',
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review: submit
    Review --> Draft: changes
    Review --> Published: approve
    Published --> [*]`,
  },
  {
    label: 'Class',
    code: `classDiagram
    class Item {
      +string id
      +string title
    }
    class Tag
    Item "1" --> "*" Tag`,
  },
];

export default function DiagramEditor({
  editId,
  collectionId,
  initialTitle,
  tc = '#3f8a86',
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
  const [code, setCode] = useState(isEdit ? '' : STARTER);
  const [initialCode, setInitialCode] = useState(isEdit ? '' : STARTER);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [svg, setSvg] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderSeq = useRef(0);

  const [prompt, setPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [copied, setCopied] = useState(false);

  // Edit mode: load the diagram's current source.
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    getRawText(editId)
      .then(({ content }) => {
        if (cancelled) return;
        setCode(content);
        setInitialCode(content);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  // Debounced live render.
  useEffect(() => {
    if (loading) return;
    const handle = setTimeout(async () => {
      const seq = ++renderSeq.current;
      if (!code.trim()) {
        setSvg('');
        setRenderError(null);
        return;
      }
      try {
        const out = await renderMermaid(code);
        if (seq === renderSeq.current) {
          setSvg(out);
          setRenderError(null);
        }
      } catch (err) {
        if (seq === renderSeq.current) setRenderError(err instanceof Error ? err.message : String(err));
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [code, loading]);

  const dirty = isEdit
    ? title.trim() !== (initialTitle ?? '') || code !== initialCode
    : title.trim().length > 0 || code !== STARTER;

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runAssistant = useCallback(async () => {
    const instruction = prompt.trim();
    if (!instruction || aiBusy) return;
    setAiBusy(true);
    setError(null);
    setAiNote('');
    try {
      const res = await assistDiagram(instruction, code, collectionId);
      if (!res.mermaid.trim()) throw new Error('The assistant returned an empty diagram');
      setCode(res.mermaid);
      const sources = res.usedSources ?? [];
      const grounded =
        sources.length > 0
          ? ` · grounded in ${sources.length} file${sources.length !== 1 ? 's' : ''}: ${sources.join(', ')}`
          : '';
      setAiNote((res.explanation || 'Updated the diagram.') + grounded);
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [prompt, code, aiBusy, collectionId]);

  const copyCode = useCallback(async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function downloadSvg() {
    if (svg) download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${title || 'diagram'}.svg`);
  }
  function downloadPng() {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = (img.naturalWidth || 800) * scale;
      canvas.height = (img.naturalHeight || 600) * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => b && download(b, `${title || 'diagram'}.png`), 'image/png');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function handleSave() {
    const t = title.trim();
    if (!t) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAuthoredArtifact({ editId, collectionId, kind: 'diagram', title: t, content: code });
      toast(isEdit ? 'Diagram saved' : collectionId ? 'Diagram saved to collection' : 'Diagram saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

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
            <Icon id="i-diagram" />
          </span>
          <b style={{ flex: 1 }}>{isEdit ? 'Edit diagram' : 'New diagram'}</b>
          <button className="btn btn-primary" disabled={saving || loading || !title.trim() || !dirty} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save diagram'}
          </button>
          <button className="icon-btn" onClick={requestClose} disabled={saving}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px' }}>
          <input
            className="input"
            placeholder="Diagram title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            style={{ fontWeight: 600 }}
          />

          {/* AI assist bar */}
          <div style={{ border: '1px solid var(--line)', background: 'var(--card-2)', borderRadius: 10, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: tc, display: 'inline-flex' }}>
                <Icon id="i-spark" />
              </span>
              <input
                className="input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runAssistant();
                  }
                }}
                disabled={aiBusy || loading}
                placeholder={
                  collectionId
                    ? 'Describe a diagram — grounded in this collection’s files…'
                    : 'Describe the diagram you want, or how to change it…'
                }
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={() => void runAssistant()} disabled={aiBusy || loading || !prompt.trim()}>
                <Icon id="i-spark" /> {aiBusy ? 'Thinking…' : 'Generate'}
              </button>
            </div>
            {aiNote && <p className="hint" style={{ margin: '8px 0 0' }}>✺ {aiNote}</p>}
          </div>

          {loading ? (
            <div className="empty">Loading diagram…</div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Source */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Mermaid source
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <select
                      className="input"
                      value=""
                      onChange={(e) => {
                        const tpl = TEMPLATES.find((t) => t.label === e.target.value);
                        if (tpl) setCode(tpl.code);
                      }}
                      style={{ height: 28, padding: '0 8px', fontSize: 12, width: 'auto' }}
                      title="Insert a template"
                    >
                      <option value="">Template…</option>
                      {TEMPLATES.map((t) => (
                        <option key={t.label} value={t.label}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-soft" style={{ height: 28, padding: '0 10px' }} onClick={copyCode}>
                      <Icon id="i-copy" /> {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  disabled={saving}
                  style={{
                    flex: 1,
                    minHeight: 220,
                    resize: 'none',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'var(--card-2)',
                    color: 'var(--ink)',
                    padding: '10px 12px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 12.5,
                    lineHeight: 1.6,
                  }}
                />
              </div>

              {/* Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    Preview
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="btn btn-soft" style={{ height: 28, padding: '0 10px' }} onClick={downloadSvg} disabled={!svg}>
                      <Icon id="i-download" /> SVG
                    </button>
                    <button className="btn btn-soft" style={{ height: 28, padding: '0 10px' }} onClick={downloadPng} disabled={!svg}>
                      <Icon id="i-download" /> PNG
                    </button>
                  </div>
                </div>
                <div style={{ position: 'relative', flex: 1, minHeight: 220, overflow: 'auto', borderRadius: 8, border: '1px solid var(--line)', background: '#ffffff', padding: 12 }}>
                  {renderError && (
                    <div
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        display: 'flex',
                        gap: 6,
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        borderRadius: 6,
                        padding: '6px 8px',
                        fontSize: 11,
                        fontFamily: 'JetBrains Mono, monospace',
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ wordBreak: 'break-word' }}>{renderError}</span>
                    </div>
                  )}
                  {svg ? (
                    <div
                      style={{ display: 'flex', justifyContent: 'center' }}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                  ) : (
                    !renderError && (
                      <p style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', paddingTop: 24 }}>
                        Diagram preview
                      </p>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="hint" style={{ color: 'var(--accent)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
