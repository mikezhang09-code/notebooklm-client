/**
 * In-app artifact viewer — renders every preview type the backend supports
 * (GET /api/corpus/artifacts/:id/view): PDF/HTML in an iframe, Office via the
 * Office Online embed, DOCX/Markdown/CSV/JSON as rendered HTML (with a GitHub-
 * style body + a closable heading outline), plain text in a <pre>, and a
 * download fallback for unsupported types.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { getView, type ViewPayload } from '../lib/artifacts';

interface Heading {
  id: string;
  text: string;
  level: number;
}

function slugify(text: string, i: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `h-${i}-${base || 'section'}`.slice(0, 64);
}

export default function Viewer({
  id,
  title,
  tc = 'var(--accent)',
  onClose,
}: {
  id: string;
  title: string;
  tc?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<ViewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getView(id)
      .then((v) => !cancelled && setView(v))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // After HTML content renders, extract headings → outline (and tag them with ids).
  useEffect(() => {
    if (view?.type !== 'html' || !bodyRef.current) {
      setHeadings([]);
      return;
    }
    const nodes = Array.from(
      bodyRef.current.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
    );
    const list: Heading[] = nodes.map((node, i) => {
      const text = node.textContent?.trim() ?? `Section ${i + 1}`;
      if (!node.id) node.id = slugify(text, i);
      return { id: node.id, text, level: Number(node.tagName[1]) };
    });
    setHeadings(list);
    setOutlineOpen(list.length > 1);
  }, [view]);

  function scrollTo(hid: string) {
    bodyRef.current?.querySelector(`#${CSS.escape(hid)}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  const hasOutline = view?.type === 'html' && headings.length > 0;
  // Indent nested headings relative to the document's shallowest level.
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 1180,
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
            <Icon id="i-doc" />
          </span>
          <b
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </b>
          {hasOutline && (
            <button
              className="icon-btn"
              title={outlineOpen ? 'Hide outline' : 'Show outline'}
              onClick={() => setOutlineOpen((o) => !o)}
            >
              <Icon id="i-rows" />
            </button>
          )}
          {view && 'downloadUrl' in view && (
            <a className="btn btn-soft" href={view.downloadUrl} download>
              <Icon id="i-download" /> Download
            </a>
          )}
          <button className="icon-btn" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--card-2)' }}>
            {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}
            {!error && !view && <div className="empty">Loading preview…</div>}

            {view?.type === 'pdf' && (
              <iframe title={title} src={view.downloadUrl} style={{ width: '100%', height: '100%', border: 0 }} />
            )}
            {view?.type === 'office' && (
              <iframe title={title} src={view.officeViewerUrl} style={{ width: '100%', height: '100%', border: 0 }} />
            )}
            {view?.type === 'image' && (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%', padding: 24 }}>
                <img
                  src={view.downloadUrl}
                  alt={title}
                  style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: 'var(--shadow)' }}
                />
              </div>
            )}
            {view?.type === 'html' && (
              <div
                ref={bodyRef}
                className="md-body"
                style={{ padding: '32px 44px', maxWidth: 860, margin: '0 auto' }}
                dangerouslySetInnerHTML={{ __html: view.content }}
              />
            )}
            {view?.type === 'text' && (
              <pre
                style={{
                  padding: '24px 28px',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12.5,
                  color: 'var(--ink)',
                }}
              >
                {view.content}
              </pre>
            )}
            {view?.type === 'unsupported' && (
              <div className="empty">
                <Icon id="i-doc" />
                <p>No inline preview for this file type.</p>
                <a className="btn btn-primary" href={view.downloadUrl} download style={{ marginTop: 12 }}>
                  <Icon id="i-download" /> Download
                </a>
              </div>
            )}
          </div>

          {hasOutline && outlineOpen && (
            <aside className="md-outline">
              <div className="md-outline-head">
                <b>Outline</b>
                <button className="icon-btn" title="Close outline" onClick={() => setOutlineOpen(false)}>
                  <Icon id="i-close" />
                </button>
              </div>
              {headings.map((h) => (
                <a
                  key={h.id}
                  className={`lvl-${h.level}`}
                  style={{ paddingLeft: 8 + Math.max(0, h.level - minLevel) * 14 }}
                  onClick={() => scrollTo(h.id)}
                >
                  {h.text}
                </a>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
