/**
 * Render an assistant answer as safe HTML: parse the Markdown the model emits
 * (headings, bold, lists, rules) and turn inline `[1, 2]` / `[13-15]` citation
 * markers into small numbered chips, the way NotebookLM displays them. Chips
 * carry a `data-src` attribute so callers can wire clicks to a source.
 *
 * The answer is model output that can echo source HTML or be steered by prompt
 * injection, so it is sanitised before being injected via dangerouslySetInnerHTML.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderAnswer(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
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
  return DOMPurify.sanitize(html);
}
