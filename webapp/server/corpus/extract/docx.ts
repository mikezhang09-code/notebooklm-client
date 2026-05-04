/**
 * DOCX text extractor via `mammoth`.
 */

import mammoth from 'mammoth';

export async function extractDocx(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value ?? '';
}
