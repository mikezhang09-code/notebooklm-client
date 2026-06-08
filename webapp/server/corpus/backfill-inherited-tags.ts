/**
 * Backfill: propagate every collection's and notebook's tags onto the artifacts
 * that belong to them (union with each artifact's own manual tags). Use this to
 * apply group tags that were set before tag-inheritance existed, or that were
 * set while an old server build was running.
 *
 * Idempotent — re-running produces the same result.
 *
 * Usage (from webapp/):
 *   npx tsx server/corpus/backfill-inherited-tags.ts
 */

import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection, closeDbPool } from './oci/db.js';
import { cleanTags, parseTagArray, resyncGroupTags } from './tags.js';

async function main(): Promise<number> {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('Corpus disabled (missing env). Nothing to do.');
    return 1;
  }

  await withConnection(cfg, async (conn) => {
    // Collections.
    const cols = await conn.execute<{ ID: string; NAME: string; TAGS: unknown }>(
      `SELECT id, name, tags FROM collections`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    for (const c of cols.rows ?? []) {
      const tags = cleanTags(parseTagArray(c.TAGS));
      const n = await resyncGroupTags(conn, 'collection_id', c.ID, tags);
      console.log(`collection "${c.NAME}" [${tags.join(', ') || '—'}] → ${n} artifact(s)`);
    }

    // Notebooks (table may not exist if the migration wasn't applied).
    try {
      const nbs = await conn.execute<{ ID: string; TAGS: unknown }>(
        `SELECT id, tags FROM notebooks`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const nb of nbs.rows ?? []) {
        const tags = cleanTags(parseTagArray(nb.TAGS));
        const n = await resyncGroupTags(conn, 'notebook_id', nb.ID, tags);
        console.log(`notebook ${nb.ID} [${tags.join(', ') || '—'}] → ${n} artifact(s)`);
      }
    } catch (err) {
      if (/ORA-00942/i.test(err instanceof Error ? err.message : String(err))) {
        console.log('notebooks table not present — skipping notebook backfill.');
      } else {
        throw err;
      }
    }

    await conn.commit();
  });

  await closeDbPool();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('backfill failed:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
