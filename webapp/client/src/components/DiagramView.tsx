/**
 * Diagram viewer — renders a `diagram` artifact's raw Mermaid source to an
 * inline SVG and offers an SVG download. Ported in spirit from the
 * research-corpus portal's DiagramModal, restyled to the app's design system.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getRawText, type Item } from '../lib/artifacts';
import { renderMermaid } from '../lib/mermaid-render';

export default function DiagramView({
  item,
  tc = 'var(--accent)',
  onClose,
  onEdit,
}: {
  item: Item;
  tc?: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRawText(item.id)
      .then((r) => renderMermaid(r.content))
      .then((out) => !cancelled && setSvg(out))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function downloadSvg() {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title || 'diagram'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: expanded ? 0 : 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: expanded ? '100vw' : '92vw',
          maxWidth: expanded ? 'none' : 1100,
          height: expanded ? '100vh' : '88vh',
          background: 'var(--bg)',
          border: expanded ? 'none' : '1px solid var(--line)',
          borderRadius: expanded ? 0 : 16,
          boxShadow: expanded ? 'none' : 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="t-ic" style={{ width: 34, height: 34 }}>
            <Icon id="i-diagram" />
          </span>
          <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </b>
          <button className="btn btn-soft" onClick={downloadSvg} disabled={!svg}>
            <Icon id="i-download" /> SVG
          </button>
          {onEdit && (
            <button className="btn btn-soft" onClick={onEdit}>
              <Icon id="i-doc" /> Edit
            </button>
          )}
          <button className="icon-btn" title={expanded ? 'Restore' : 'Expand'} onClick={() => setExpanded((e) => !e)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              {expanded ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          <button className="icon-btn" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#ffffff', padding: 24 }}>
          {error ? (
            <div className="empty" style={{ color: 'var(--accent)' }}>
              {error}
            </div>
          ) : svg ? (
            <div
              style={{ display: 'flex', justifyContent: 'center' }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="empty" style={{ color: '#475569' }}>
              Rendering diagram…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
