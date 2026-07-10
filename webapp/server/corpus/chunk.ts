/**
 * Text chunker.
 *
 * Produces overlapping windows of approximately `maxChars` characters each,
 * with `overlap` characters of context repeated between adjacent chunks.
 * Tries to cut at paragraph or sentence boundaries when they fall within a
 * small tolerance of the target length — retrieval quality is noticeably
 * better when chunks don't start mid-word.
 */

export interface Chunk {
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  /** Rough estimate — ~4 chars ≈ 1 token for English, ~2 for CJK. */
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Target max characters per chunk. Default 1600 (~ 400 tokens en, ~800 cjk). */
  maxChars?: number;
  /** Characters of overlap between adjacent chunks. Default 200. */
  overlap?: number;
  /** Window (± chars) within which we look for a sentence/paragraph cut. Default 200. */
  boundarySearch?: number;
}

// Detects the end of a sentence followed by whitespace (optional) and a new
// word. Handles English, CJK full-width punctuation, and common abbreviations
// awkwardly — good enough for M2; we can get fancier later.
const SENTENCE_END = /([.!?。！？])\s+(?=[A-Z\u4e00-\u9fff])/g;
const PARAGRAPH_BREAK = /\n\s*\n/g;

/**
 * Finds the best cut position ≤ target, preferring paragraph breaks,
 * then sentence ends. If nothing acceptable is found, returns `target`
 * (hard cut, possibly mid-word).
 */
function findCutPoint(text: string, target: number, searchRadius: number): number {
  const start = Math.max(0, target - searchRadius);
  const end = Math.min(text.length, target);
  const window = text.slice(start, end);

  // Prefer paragraph break — rightmost one in the window, closest to target.
  let lastPara = -1;
  for (let m; (m = PARAGRAPH_BREAK.exec(window)); ) lastPara = m.index + m[0].length;
  PARAGRAPH_BREAK.lastIndex = 0;
  if (lastPara >= 0) return start + lastPara;

  // Fall back to sentence end.
  let lastSent = -1;
  for (let m; (m = SENTENCE_END.exec(window)); ) lastSent = m.index + m[1].length;
  SENTENCE_END.lastIndex = 0;
  if (lastSent >= 0) return start + lastSent;

  // Last resort — whitespace.
  for (let i = end; i > start; i--) {
    if (/\s/.test(text[i - 1] ?? '')) return i;
  }

  return target;
}

/**
 * Split `text` into overlapping chunks. Empty / whitespace-only input
 * produces zero chunks (caller should handle).
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1600;
  const overlap = opts.overlap ?? 200;
  const boundarySearch = opts.boundarySearch ?? 200;

  if (overlap >= maxChars) {
    throw new Error(`overlap (${overlap}) must be < maxChars (${maxChars})`);
  }

  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length === 0) return [];

  // Fast path for short texts.
  if (clean.length <= maxChars) {
    return [
      {
        ordinal: 0,
        text: clean,
        charStart: 0,
        charEnd: clean.length,
        tokenEstimate: estimateTokens(clean),
      },
    ];
  }

  const chunks: Chunk[] = [];
  let cursor = 0;
  let ordinal = 0;

  while (cursor < clean.length) {
    const hardEnd = Math.min(cursor + maxChars, clean.length);
    const cutAt =
      hardEnd === clean.length
        ? clean.length
        : findCutPoint(clean, hardEnd, boundarySearch);
    const piece = clean.slice(cursor, cutAt).trim();
    if (piece.length > 0) {
      chunks.push({
        ordinal,
        text: piece,
        charStart: cursor,
        charEnd: cutAt,
        tokenEstimate: estimateTokens(piece),
      });
      ordinal += 1;
    }
    if (cutAt >= clean.length) break;
    // Step forward, keeping `overlap` chars of tail as head of next chunk.
    cursor = Math.max(cutAt - overlap, cursor + 1);
  }

  return chunks;
}

/** A cell is numeric-ish if it's a number, "801+", "1201-1400", "7=", "51.2%" … */
const NUMERIC_CELL = /^-?\d+(\.\d+)?([-–=+%]\d*(\.\d+)?)?[=+%]?$/;

/**
 * Detect the leading header lines of CSV-ish tabular text: consume the first
 * few lines until one looks like a data row (≥ half of its non-empty cells
 * numeric). Real-world ranking sheets carry 2–3 header lines (a title row, a
 * year row like ",2026,2025,Institution,…", then the column names) before the
 * data starts. Returns null when the very first line already looks like data.
 */
export function detectTableHeader(text: string): string | null {
  const lines = text.split('\n', 5).slice(0, 4);
  const headers: string[] = [];
  for (const line of lines) {
    const cells = line
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const numeric = cells.filter((c) => NUMERIC_CELL.test(c));
    if (cells.length >= 2 && numeric.length / cells.length >= 0.5) break; // data row
    headers.push(line.length > 200 ? `${line.slice(0, 200)}…` : line);
  }
  const joined = headers.join('\n').trim();
  return joined.length > 0 ? joined.slice(0, 600) : null;
}

/**
 * Chunk an artifact's text, prefixing every chunk of tabular data
 * (kind='data_table') with the artifact title and the table's header lines.
 * A mid-file slice of a ranking table is otherwise anonymous rows — the
 * title tells the embedding (and later the chat model) *which* table the
 * rows belong to, and the header is what makes a row like "38,38,34,
 * Columbia University,…" interpretable (rank vs previous-year rank).
 * `charStart`/`charEnd` keep referring to the un-prefixed source text.
 */
export function chunkArtifactText(
  text: string,
  meta: { kind?: string; title?: string },
  opts: ChunkOptions = {},
): Chunk[] {
  const chunks = chunkText(text, opts);
  const title = meta.title?.trim();
  if (meta.kind !== 'data_table' || !title) return chunks;
  const header = detectTableHeader(text);
  const prefix = header && !header.includes(title) ? `${title}\n${header}` : (header ?? title);
  return chunks.map((c) => {
    const prefixed = `${prefix}\n${c.text}`;
    return { ...c, text: prefixed, tokenEstimate: estimateTokens(prefixed) };
  });
}

/** Crude byte-length-based token estimate; fine for logging/budgeting. */
export function estimateTokens(text: string): number {
  // Favour the CJK-heavy side (2 chars/token) because our embed model is
  // multilingual and we want conservative limits.
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
  }
  const ascii = text.length - cjk;
  return Math.ceil(cjk / 1.5 + ascii / 4);
}
