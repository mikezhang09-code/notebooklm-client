/**
 * Assemble the extracted text of a collection's artifacts into one capped
 * context block. Shared by the two in-collection generators:
 *   • the direct-LLM path (POST /api/corpus/collections/:id/generate), and
 *   • the NotebookLM path (POST /api/generate/:kind with a `collection` source),
 *     which injects the block as a single NotebookLM text source.
 */
import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { getObjectBuffer } from './oci/storage.js';
import { extract } from './extract/index.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export interface CollectionContext {
  /** Concatenated "## Title\n<text>" blocks, capped to `charCap`. */
  text: string;
  /** Titles of the artifacts that contributed text, in order. */
  sources: string[];
}

/**
 * Read up to `charCap` characters of text across a collection's artifacts.
 * `fileIds` restricts to a subset (scoped to the collection); when empty, every
 * artifact in the collection is used. Unreadable artifacts are skipped.
 */
export async function assembleCollectionText(
  cfg: CorpusConfig,
  collectionId: string,
  fileIds: string[],
  charCap: number,
): Promise<CollectionContext> {
  const ids = fileIds.filter((x) => ULID_RE.test(x));
  const rows = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<{ OBJECT_NAME: string; MIME_TYPE: string | null; TITLE: string }>(
      ids.length > 0
        ? `SELECT object_name, mime_type, title FROM artifacts
             WHERE collection_id = :c AND id IN (${ids.map((_, i) => `:f${i}`).join(',')})`
        : `SELECT object_name, mime_type, title FROM artifacts WHERE collection_id = :c`,
      ids.length > 0
        ? { c: collectionId, ...Object.fromEntries(ids.map((id, i) => [`f${i}`, id])) }
        : { c: collectionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });

  let budget = charCap;
  const parts: string[] = [];
  const sources: string[] = [];
  for (const row of rows) {
    if (budget <= 0) break;
    try {
      const buffer = await getObjectBuffer(cfg, row.OBJECT_NAME);
      const text = (await extract(buffer, row.MIME_TYPE ?? undefined, row.OBJECT_NAME)).trim();
      if (!text) continue;
      const entry = `## ${row.TITLE}\n${text.slice(0, budget)}`;
      budget -= entry.length;
      parts.push(entry);
      sources.push(row.TITLE);
    } catch {
      /* skip unreadable artifact */
    }
  }
  return { text: parts.join('\n\n'), sources };
}
