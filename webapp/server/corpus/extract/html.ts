/**
 * HTML text extractor — no heavy deps; just a regex-based tag stripper.
 *
 * Good enough for NotebookLM report outputs and typical web pages.
 * If we later need semantic extraction (article content only, skipping
 * nav/footer), swap in `@mozilla/readability` + `jsdom`.
 */

export async function extractHtml(buf: Buffer): Promise<string> {
  let html = buf.toString('utf8');

  // Drop script/style blocks entirely (contents are not human-facing).
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');

  // Convert common block-level tags to newlines so paragraph structure survives.
  html = html.replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n');
  html = html.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags.
  html = html.replace(/<[^>]+>/g, '');

  // Decode the 5 common HTML entities. Anything more exotic stays as-is.
  html = html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse runs of whitespace but keep paragraph breaks.
  html = html.replace(/[ \t]+/g, ' ');
  html = html.replace(/\n\s*\n+/g, '\n\n');

  return html.trim();
}
