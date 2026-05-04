/**
 * Plain-text / Markdown extractor — trivially decodes the buffer.
 */

export async function extractText(buf: Buffer): Promise<string> {
  // Strip UTF-8 BOM if present.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  return buf.toString('utf8');
}
