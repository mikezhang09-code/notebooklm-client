/**
 * Notebook-level tags.
 *
 * Google NotebookLM owns a notebook's name + artifacts, so the corpus can't
 * mutate those. What it *can* own is a set of library-side tags for the
 * notebook, stored here in the `notebooks` table (created lazily on first tag).
 * Setting them propagates onto every saved artifact of that notebook and is
 * inherited by artifacts saved later — symmetric with collection tags.
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { cleanTags, parseTagArray, resyncGroupTags } from './tags.js';

export interface NotebookTags {
  id: string;
  title: string | null;
  tags: string[];
}

/** Fetch a notebook's tags. Returns an empty tag list if it's never been tagged. */
export async function getNotebookTags(
  cfg: CorpusConfig,
  id: string,
): Promise<NotebookTags> {
  return withConnection(cfg, async (conn) => {
    try {
      const r = await conn.execute<{ TITLE: string | null; TAGS: unknown }>(
        `SELECT title, tags FROM notebooks WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = r.rows?.[0];
      return {
        id,
        title: row?.TITLE ?? null,
        tags: cleanTags(parseTagArray(row?.TAGS)),
      };
    } catch (err) {
      // notebooks table not migrated yet → behave as "untagged".
      if (/ORA-00942/i.test(err instanceof Error ? err.message : String(err))) {
        return { id, title: null, tags: [] };
      }
      throw err;
    }
  });
}

/**
 * Upsert a notebook's tags and propagate them onto its saved artifacts in one
 * transaction. `title` is optional — stored when provided so the row carries a
 * human-readable name. Returns the cleaned tags + the number of artifacts
 * re-synced.
 */
export async function setNotebookTags(
  cfg: CorpusConfig,
  id: string,
  tags: string[],
  title?: string,
): Promise<{ tags: string[]; artifactsUpdated: number }> {
  const cleaned = cleanTags(tags);
  return withConnection(cfg, async (conn) => {
    try {
      await conn.execute(
      `MERGE INTO notebooks t
         USING (SELECT :id AS id FROM dual) s
         ON (t.id = s.id)
       WHEN MATCHED THEN
         UPDATE SET t.tags = :tags,
                    t.title = COALESCE(:title, t.title),
                    t.updated_at = SYSTIMESTAMP
       WHEN NOT MATCHED THEN
         INSERT (id, title, tags, metadata)
         VALUES (:id, :title, :tags, '{}')`,
      {
        id,
        tags: JSON.stringify(cleaned),
        title: title?.slice(0, 512) ?? null,
      },
      { autoCommit: false },
    );
      const artifactsUpdated = await resyncGroupTags(conn, 'notebook_id', id, cleaned);
      await conn.commit();
      return { tags: cleaned, artifactsUpdated };
    } catch (err) {
      if (/ORA-00942/i.test(err instanceof Error ? err.message : String(err))) {
        throw new Error(
          'notebooks table not found — run: npx tsx server/corpus/run-migration.ts schema.alter-notebooks.sql',
        );
      }
      throw err;
    }
  });
}
