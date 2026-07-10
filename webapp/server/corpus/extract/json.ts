/**
 * JSON extractor.
 *
 * Tabular JSON — an array of flat records like
 *   [{ "name": "Harvard University", "rank": "1", ... }, ...]
 * — is rendered as CSV (header + one line per record). That matters for two
 * reasons: repeated keys make raw JSON ~2× bigger than the same data as CSV
 * (so whole files stop fitting the chat's whole-document budget), and the
 * embedding model ranks a clean "one record per line" chunk far better than
 * a brace-and-quote soup.
 *
 * Anything that doesn't look tabular (config objects, nested trees, arrays
 * of scalars) falls back to the raw UTF-8 text unchanged.
 */

import { extractText } from './text.js';

type JsonRecord = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Find the array of records to tabulate: either the document root, or —
 * for wrapper shapes like { "data": [...] } — the largest array-of-objects
 * value on the root object.
 */
function findRecords(data: unknown): JsonRecord[] | null {
  const asRecords = (v: unknown): JsonRecord[] | null =>
    Array.isArray(v) && v.length > 0 && v.every(isPlainObject) ? (v as JsonRecord[]) : null;

  const root = asRecords(data);
  if (root) return root;

  if (isPlainObject(data)) {
    let best: JsonRecord[] | null = null;
    for (const value of Object.values(data)) {
      const rows = asRecords(value);
      if (rows && (!best || rows.length > best.length)) best = rows;
    }
    return best;
  }
  return null;
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = isPlainObject(v) || Array.isArray(v) ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render records as CSV. Columns are the union of keys in first-seen order. */
export function jsonRecordsToCsv(records: JsonRecord[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const rec of records) {
    lines.push(columns.map((c) => csvCell(rec[c])).join(','));
  }
  return lines.join('\n');
}

export async function extractJson(buf: Buffer): Promise<string> {
  const raw = await extractText(buf);
  try {
    const records = findRecords(JSON.parse(raw));
    if (records) return jsonRecordsToCsv(records);
  } catch {
    /* not valid JSON — fall through to the raw text */
  }
  return raw;
}
