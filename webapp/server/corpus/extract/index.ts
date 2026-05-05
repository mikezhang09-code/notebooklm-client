/**
 * Text-extraction dispatcher.
 *
 * Given a Buffer + MIME type, returns plain UTF-8 text that's safe to
 * chunk + embed. Unknown types fall back to the text extractor.
 *
 * Binary container formats (audio/video/images/zip/etc.) intentionally
 * return an empty string instead of `buf.toString('utf8')` — feeding raw
 * MP4/MP3 bytes through a UTF-8 decode produces mojibake that ends up
 * embedded as if it were real Chinese, then surfaces as junk hits in
 * search and chat. Until we wire a transcription / OCR step, the row
 * still lands in the catalog with the blob in Object Storage; only the
 * `chunks` column stays empty.
 */

import { extractText } from './text.js';
import { extractPdf } from './pdf.js';
import { extractDocx } from './docx.js';
import { extractHtml } from './html.js';

/**
 * MIME prefixes that are known to be opaque binary blobs we can't turn
 * into text without an external service (transcription, OCR, archive
 * extraction, etc.). Anything matching one of these short-circuits to
 * an empty-string extractor.
 */
const BINARY_MIME_PREFIXES = [
  'audio/',
  'video/',
  'image/',
  'font/',
  'application/zip',
  'application/x-zip',
  'application/x-7z-compressed',
  'application/x-rar',
  'application/x-tar',
  'application/gzip',
  'application/x-bzip',
  'application/octet-stream',
];

const BINARY_EXTENSIONS = new Set([
  // audio
  'mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma',
  // video
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', 'mpg', 'wmv',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'svg',
  // archives
  'zip', '7z', 'rar', 'tar', 'gz', 'bz2',
  // misc binaries
  'exe', 'dll', 'so', 'dylib', 'class',
]);

async function extractEmpty(_buf: Buffer): Promise<string> {
  return '';
}

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

  // Binary container formats — return empty text. The row still lands in
  // the catalog with the blob in Object Storage; only the `chunks` and
  // text columns stay empty.
  if (BINARY_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    return extractEmpty;
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    return extractEmpty;
  }

  // text/plain, text/markdown, application/json, application/javascript,
  // application/xml, etc. — safe to UTF-8 decode.
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
