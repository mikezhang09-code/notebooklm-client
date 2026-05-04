/**
 * Text-extraction dispatcher.
 *
 * Given a Buffer + MIME type, returns plain UTF-8 text that's safe to
 * chunk + embed. Unknown types fall back to the text extractor (still
 * useful for `.md`, `.csv`, `.log`, etc.).
 */

import { extractText } from './text.js';
import { extractPdf } from './pdf.js';
import { extractDocx } from './docx.js';
import { extractHtml } from './html.js';

/**
 * Detects which extractor to use. We prefer MIME over filename because
 * MIME is what Object Storage + browsers carry, but filename is a fallback.
 */
export function pickExtractor(
  mimeType: string | undefined,
  filename?: string,
): (buf: Buffer) => Promise<string> {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = (filename?.split('.').pop() ?? '').toLowerCase();

  if (mime === 'application/pdf' || ext === 'pdf') return extractPdf;

  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return extractDocx;
  }

  if (mime.startsWith('text/html') || ext === 'html' || ext === 'htm') {
    return extractHtml;
  }

  // text/plain, text/markdown, application/json, audio/* (binary — will
  // return garbage but at least the row still lands), anything else.
  return extractText;
}

/** Convenience: dispatch + run in one call. */
export async function extract(
  buf: Buffer,
  mimeType?: string,
  filename?: string,
): Promise<string> {
  const fn = pickExtractor(mimeType, filename);
  try {
    return await fn(buf);
  } catch (err) {
    // Extraction is best-effort. Never let a bad byte in a PDF block the
    // whole ingest; just record empty text and move on.
    console.warn(
      `[corpus] text extraction failed for mime=${mimeType} file=${filename}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return '';
  }
}
