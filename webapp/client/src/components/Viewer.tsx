/**
 * In-app artifact viewer — renders every preview type the backend supports
 * (GET /api/corpus/artifacts/:id/view): PDF/HTML in an iframe, Office via the
 * Office Online embed, DOCX/Markdown/CSV/JSON as rendered HTML (with a GitHub-
 * style body + a closable heading outline), plain text in a <pre>, and a
 * download fallback for unsupported types.
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { Icon } from './Icon';
import MindmapView from './MindmapView';
import { MarkdownView, sanitizeHtml } from '../lib/markdown';
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
  const [expanded, setExpanded] = useState(false);
  // Set when an <audio>/<video> element can't decode the file (unsupported codec).
  const [mediaError, setMediaError] = useState(false);
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

  // After HTML/Markdown content renders, extract headings → outline (and tag them with ids).
  useEffect(() => {
    if ((view?.type !== 'html' && view?.type !== 'markdown') || !bodyRef.current) {
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

  const hasOutline =
    (view?.type === 'html' || view?.type === 'markdown') && headings.length > 0;
  // Indent nested headings relative to the document's shallowest level.
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: expanded ? 0 : 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: expanded ? '100vw' : '92vw',
          maxWidth: expanded ? 'none' : 1180,
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
          <button
            className="icon-btn"
            title={expanded ? 'Restore' : 'Expand to full screen'}
            onClick={() => setExpanded((e) => !e)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              {expanded ? (
                <path
                  d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
          <button className="icon-btn" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: view?.type === 'mindmap' ? 'hidden' : 'auto',
              background: 'var(--card-2)',
            }}
          >
            {error && <div className="empty" style={{ color: 'var(--accent)' }}>{error}</div>}
            {!error && !view && <div className="empty">Loading preview…</div>}

            {view?.type === 'mindmap' && <MindmapView tree={view.tree} />}

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
            {view?.type === 'video' &&
              (mediaError ? (
                <MediaFallback kind="video" url={view.downloadUrl} />
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%', padding: 24 }}>
                  <video
                    src={view.downloadUrl}
                    controls
                    onError={() => setMediaError(true)}
                    style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: 'var(--shadow)' }}
                  />
                </div>
              ))}
            {view?.type === 'audio' &&
              (mediaError ? (
                <MediaFallback kind="audio" url={view.downloadUrl} />
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%', padding: 24 }}>
                  <audio
                    src={view.downloadUrl}
                    controls
                    onError={() => setMediaError(true)}
                    style={{ width: 'min(560px, 90%)' }}
                  />
                </div>
              ))}
            {view?.type === 'html' && (
              <MarkdownView
                ref={bodyRef}
                html={sanitizeHtml(view.content)}
                style={{ padding: '32px 44px', maxWidth: 860, margin: '0 auto' }}
              />
            )}
            {view?.type === 'markdown' && (
              <MarkdownView
                ref={bodyRef}
                source={view.content}
                style={{ padding: '32px 44px', maxWidth: 860, margin: '0 auto' }}
              />
            )}
            {view?.type === 'react' && (
              <ReactArtifactView content={view.content} language={view.language} title={title} />
            )}
            {view?.type === 'code' && (
              <CodeView content={view.content} language={view.language} />
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

/** Shown when the browser can't decode an audio/video file's codec. */
function MediaFallback({ kind, url }: { kind: 'audio' | 'video'; url: string }) {
  return (
    <div className="empty">
      <Icon id={kind === 'video' ? 'i-video' : 'i-audio'} />
      <p>This {kind} format can’t be played in your browser. Download it to play in another app.</p>
      <a className="btn btn-primary" href={url} download style={{ marginTop: 12 }}>
        <Icon id="i-download" /> Download
      </a>
    </div>
  );
}

interface CommonJsModule {
  exports: unknown;
}

type RenderTarget = React.ComponentType<Record<string, never>> | React.ReactElement;
type RuntimeModules = {
  lucide: Record<string, unknown>;
  recharts: Record<string, unknown>;
};
type PreviewWindow = Window & typeof globalThis & {
  React?: typeof React;
  ReactDOM?: typeof ReactDOMClient;
  ReactDOMClient?: typeof ReactDOMClient;
  Function: FunctionConstructor;
  ResizeObserver?: typeof ResizeObserver;
};

function moduleWithDefault<T extends object>(value: T): T & { default: T; __esModule: true } {
  return Object.assign({ default: value, __esModule: true as const }, value);
}

function createFallbackModule(factory: (name: string) => unknown): Record<string, unknown> {
  const target: Record<string, unknown> = { __esModule: true };
  const proxy = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'default') return proxy;
      if (typeof prop !== 'string') return undefined;
      if (!(prop in obj)) obj[prop] = factory(prop);
      return obj[prop];
    },
  });
  return proxy;
}

function fallbackIcon(name: string): React.FC<React.HTMLAttributes<HTMLSpanElement>> {
  return function IconFallback({ children: _children, style, title, ...props }) {
    return React.createElement('span', {
      ...props,
      title: typeof title === 'string' ? title : name,
      style: {
        display: 'inline-block',
        width: '1em',
        height: '1em',
        border: '1.8px solid currentColor',
        borderRadius: 4,
        verticalAlign: '-0.12em',
        ...style,
      },
    });
  };
}

function fallbackChart(name: string): React.FC<React.PropsWithChildren<Record<string, unknown>>> {
  return function ChartFallback({ children }) {
    return React.createElement('div', { className: 'react-chart-fallback', 'data-chart': name }, children);
  };
}

const lucideFallbackModule = createFallbackModule((name) => fallbackIcon(name));
const rechartsFallbackModule = createFallbackModule((name) => fallbackChart(name));

async function loadRuntimeModules(): Promise<RuntimeModules> {
  const [lucide, recharts] = await Promise.all([
    import('lucide-react')
      .then((mod) => moduleWithDefault(mod as Record<string, unknown>))
      .catch(() => lucideFallbackModule),
    import('recharts')
      .then((mod) => moduleWithDefault(mod as Record<string, unknown>))
      .catch(() => rechartsFallbackModule),
  ]);
  return { lucide, recharts };
}

function createArtifactRequire(runtimeModules: RuntimeModules) {
  const reactModule = moduleWithDefault(React);
  const reactDomClientModule = moduleWithDefault(ReactDOMClient);
  return (name: string) => {
    if (name === 'react') return reactModule;
    if (name === 'react-dom' || name === 'react-dom/client') return reactDomClientModule;
    if (name === 'react/jsx-runtime') {
      return {
        __esModule: true as const,
        Fragment: React.Fragment,
        default: { Fragment: React.Fragment, jsx: React.createElement, jsxs: React.createElement },
        jsx: React.createElement,
        jsxs: React.createElement,
      };
    }
    if (name === 'lucide-react') return runtimeModules.lucide;
    if (name === 'recharts') return runtimeModules.recharts;
    if (/\.(css|scss|sass|less)$/i.test(name)) return {};
    throw new Error('Unsupported import in JSX preview: "' + name + '"');
  };
}

function pickRenderTarget(exportsValue: unknown): RenderTarget | null {
  if (React.isValidElement(exportsValue) || typeof exportsValue === 'function') {
    return exportsValue as RenderTarget;
  }
  if (!exportsValue || typeof exportsValue !== 'object') return null;
  const record = exportsValue as Record<string, unknown>;
  for (const key of ['default', 'App', 'Main', 'Component']) {
    const candidate = record[key];
    if (React.isValidElement(candidate) || typeof candidate === 'function') {
      return candidate as RenderTarget;
    }
  }
  return null;
}

function renderTarget(root: ReactDOMClient.Root, target: RenderTarget): void {
  if (React.isValidElement(target)) {
    root.render(target);
    return;
  }
  root.render(React.createElement(target as React.ComponentType<Record<string, never>>));
}

function frameDocument(title: string): string {
  const safeTitle = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>' + safeTitle + '</title>',
    '  <style>',
    '    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; min-height: 100vh; color: #172033; background: #f7f8fb; }',
    '    button, input, textarea, select { font: inherit; }',
    '    img, svg, canvas, video { max-width: 100%; }',
    '    #root { min-height: 100vh; }',
    '    .react-chart-fallback { min-height: 120px; border: 1px dashed #b8c0cc; border-radius: 8px; padding: 12px; }',
    '  </style>',
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
  ].join('\n');
}

function measureFrameHeight(frameDoc: Document): number {
  const body = frameDoc.body;
  const root = frameDoc.documentElement;
  return Math.max(
    320,
    Math.ceil(
      Math.max(
        body.scrollHeight,
        body.offsetHeight,
        body.clientHeight,
        root.scrollHeight,
        root.offsetHeight,
        root.clientHeight,
      ),
    ),
  );
}

function syncFrameBackground(frameDoc: Document, rootEl: HTMLElement): void {
  const firstChild = rootEl.firstElementChild;
  const view = frameDoc.defaultView;
  if (!(firstChild instanceof HTMLElement) || !view) return;
  const bg = view.getComputedStyle(firstChild).backgroundColor;
  if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return;
  frameDoc.body.style.background = bg;
  rootEl.style.background = bg;
}

/** Runtime React preview for JSX/TSX artifacts. Falls back to source when compilation fails. */
function ReactArtifactView({ content, language, title }: { content: string; language: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<ReactDOMClient.Root | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(520);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    rootRef.current?.unmount();
    rootRef.current = null;
    setRuntimeError(null);
    setFrameHeight(520);

    async function run() {
      try {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const frameWindow = iframe.contentWindow;
        const frameDoc = iframe.contentDocument;
        if (!frameWindow || !frameDoc) throw new Error('Preview frame did not initialize.');
        const runtimeWindow = frameWindow as PreviewWindow;

        frameDoc.open();
        frameDoc.write(frameDocument(title));
        frameDoc.close();

        const rootEl = frameDoc.getElementById('root');
        if (!rootEl) throw new Error('Preview frame is missing its root element.');

        const [ts, runtimeModules] = await Promise.all([
          import('typescript'),
          loadRuntimeModules(),
        ]);
        if (cancelled) return;

        const compiled = ts.transpileModule(content, {
          compilerOptions: {
            allowSyntheticDefaultImports: true,
            esModuleInterop: true,
            jsx: ts.JsxEmit.React,
            jsxFactory: 'React.createElement',
            jsxFragmentFactory: 'React.Fragment',
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
          },
          fileName: language === 'tsx' ? 'artifact.tsx' : 'artifact.jsx',
          reportDiagnostics: false,
        }).outputText;

        const root = ReactDOMClient.createRoot(rootEl);
        rootRef.current = root;

        runtimeWindow.React = React;
        runtimeWindow.ReactDOM = ReactDOMClient;
        runtimeWindow.ReactDOMClient = ReactDOMClient;

        const module: CommonJsModule = { exports: {} };
        const require = createArtifactRequire(runtimeModules);
        const runModule = new runtimeWindow.Function(
          'exports',
          'module',
          'require',
          'React',
          'ReactDOM',
          'document',
          'window',
          compiled + '\n//# sourceURL=notebooklm-artifact.' + language,
        ) as (
          exports: unknown,
          module: CommonJsModule,
          require: (name: string) => unknown,
          react: typeof React,
          reactDom: typeof ReactDOMClient,
          document: Document,
          window: PreviewWindow,
        ) => void;

        runModule(module.exports, module, require, React, ReactDOMClient, frameDoc, runtimeWindow);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (cancelled) return;

        if (!rootEl.hasChildNodes()) {
          const target = pickRenderTarget(module.exports);
          if (!target) {
            throw new Error('JSX preview needs a default React component export or a createRoot(...).render(...) call.');
          }
          renderTarget(root, target);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          if (cancelled) return;
        }

        const syncLayout = () => {
          if (cancelled) return;
          syncFrameBackground(frameDoc, rootEl);
          setFrameHeight(measureFrameHeight(frameDoc));
        };

        syncLayout();
        runtimeWindow.requestAnimationFrame(syncLayout);
        runtimeWindow.setTimeout(syncLayout, 120);

        if (typeof runtimeWindow.ResizeObserver === 'function') {
          resizeObserver = new runtimeWindow.ResizeObserver(syncLayout);
          resizeObserver.observe(frameDoc.documentElement);
          resizeObserver.observe(frameDoc.body);
          resizeObserver.observe(rootEl);
        }
      } catch (err) {
        if (!cancelled) setRuntimeError(err instanceof Error ? err.message : String(err));
      }
    }

    void run();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      rootRef.current?.unmount();
      rootRef.current = null;
    };
  }, [content, language, title]);

  if (runtimeError) {
    return (
      <div className="react-artifact-view">
        <div className="react-artifact-error">
          <b>JSX preview failed</b>
          <span>{runtimeError}</span>
        </div>
        <CodeView content={content} language={language} />
      </div>
    );
  }

  return (
    <div className="react-artifact-view">
      <iframe
        ref={iframeRef}
        title={title + ' preview'}
        className="react-artifact-frame"
        style={{ height: frameHeight }}
      />
    </div>
  );
}

/** Read-only source-code preview for JS/TS and other text code files. */
function CodeView({ content, language }: { content: string; language: string }) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const hljs = (await import('highlight.js')).default;
      if (cancelled || !codeRef.current) return;
      codeRef.current.removeAttribute('data-highlighted');
      hljs.highlightElement(codeRef.current);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [content, language]);

  return (
    <div className="code-view">
      <pre>
        <code ref={codeRef} className={`language-${language}`}>{content}</code>
      </pre>
    </div>
  );
}
