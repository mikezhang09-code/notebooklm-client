/**
 * Shared Markdown rendering pipeline for the whole webapp.
 *
 * Every place that turns Markdown into HTML — the note editor preview, the
 * artifact viewer, and the chat answer bubbles — funnels through here so they
 * share one parser config and one sanitiser, and (from Phase 2) one set of
 * client-side enhancements: Mermaid diagrams, code highlighting, and math.
 *
 * Rendered HTML is always sanitised with DOMPurify before it reaches the DOM,
 * because some inputs are model output that can echo source HTML or be steered
 * by prompt injection.
 */
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { enhanceMarkdown } from './markdown-enhance';

// GFM is on by default in marked v14 (tables, strikethrough, task lists,
// autolinks). Configure once so every call site renders identically.
marked.setOptions({ gfm: true });

/** Parse Markdown → raw (unsanitised) HTML. Throws on malformed input. */
export function parseMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

/** Sanitise an HTML string for safe injection via innerHTML. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

/** Render Markdown → sanitised HTML. Falls back to escaped text on parse error. */
export function renderMarkdown(md: string): string {
  try {
    return sanitizeHtml(parseMarkdown(md));
  } catch {
    return escapeHtml(md);
  }
}

/**
 * Render an assistant answer as safe HTML: parse the Markdown the model emits,
 * then turn inline `[1, 2]` / `[13-15]` citation markers into small numbered
 * chips, the way NotebookLM displays them. Chips carry a `data-src` attribute
 * so callers can wire clicks to a source.
 */
export function renderAnswer(text: string): string {
  let html: string;
  try {
    html = parseMarkdown(text);
  } catch {
    return escapeHtml(text);
  }
  // Replace bracketed citation lists ([1, 2], [2, 5-7], [13-15]) with chips.
  // Restricted to digit/comma/space/hyphen/en-dash content so prose like
  // "[note]" or markdown links are left untouched.
  html = html.replace(/\[(\d[\d\s,–-]*)\]/g, (whole, grp: string) => {
    const parts = grp
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return whole;
    return parts
      .map((p) => `<sup class="cite-chip" data-src="${p}">${p}</sup>`)
      .join('');
  });
  return sanitizeHtml(html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

/**
 * Renders Markdown (or pre-rendered, already-sanitised HTML) into a `.md-body`
 * container. Pass `source` for Markdown, or `html` for HTML produced by another
 * trusted renderer (e.g. {@link renderAnswer}).
 *
 * Phase 2 will hang Mermaid / highlight.js / KaTeX passes off the post-render
 * effect here, so every consumer gains them at once.
 */
export interface MarkdownViewProps {
  source?: string;
  html?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export const MarkdownView = forwardRef<HTMLDivElement, MarkdownViewProps>(function MarkdownView(
  { source, html, className, style, onClick },
  ref,
) {
  const innerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement, []);

  const rendered = html ?? (source != null ? renderMarkdown(source) : '');

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.innerHTML = rendered;
    let cancelled = false;
    void enhanceMarkdown(el, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [rendered]);

  return (
    <div
      ref={innerRef}
      className={className ? `md-body ${className}` : 'md-body'}
      style={style}
      onClick={onClick}
    />
  );
});
