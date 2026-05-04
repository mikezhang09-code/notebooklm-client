/**
 * PDF text extractor.
 *
 * Uses `pdf-parse` which is a thin wrapper around pdf.js. For scanned PDFs
 * (image-only) the output will be empty — we accept that; the user can
 * still search by title, and OCR is out of scope for now.
 */

// pdf-parse's default export auto-runs a debug scan on load that looks for
// `./test/data/05-versions-space.pdf` and crashes if absent. We import the
// inner module directly to dodge that init.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export async function extractPdf(buf: Buffer): Promise<string> {
  const result = await pdfParse(buf);
  // result.text has page separators as \n\n, which plays nicely with our
  // chunker's paragraph-boundary detection.
  return result.text ?? '';
}
