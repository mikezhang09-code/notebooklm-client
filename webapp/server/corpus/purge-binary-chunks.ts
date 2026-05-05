/**
 * One-shot maintenance script: purge garbage chunks created when binary
 * artifacts (audio/video/etc.) were ingested as UTF-8 text by the M4 fallback.
 *
 * Usage (from `webapp/`):
 *
 *   npx tsx server/corpus/purge-binary-chunks.ts             # dry run
 *   npx tsx server/corpus/purge-binary-chunks.ts --apply     # actually delete
 *
 * What it does:
 *  1. Lists every artifact whose KIND is in the binary set (audio, video).
 *  2. For each one, deletes its rows from artifact_chunks.
 *  3. Leaves the artifact row + Object Storage blob alone — only the
 *     embedded chunks are bad. The blob is still useful (you can play
 *     the audio / video from the library), and re-ingest can recreate
 *     the chunks later if a transcription pipeline lands.
 *
 * Idempotent: running it twice does nothing the second time.
 */

import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';

const BINARY_KINDS = ['audio', 'video'] as const;

interface ArtifactRow {
  ID: string;
  KIND: string;
  TITLE: string;
  CHUNK_COUNT: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('[purge] corpus disabled — set env vars in .env');
    process.exit(1);
  }

  const placeholders = BINARY_KINDS.map((_, i) => `:k${i}`).join(', ');
  const binds: Record<string, string> = {};
  BINARY_KINDS.forEach((k, i) => (binds[`k${i}`] = k));

  const rows = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<ArtifactRow>(
      `SELECT a.id          AS id,
              a.kind        AS kind,
              a.title       AS title,
              (SELECT COUNT(*) FROM artifact_chunks c WHERE c.artifact_id = a.id) AS chunk_count
         FROM artifacts a
        WHERE a.kind IN (${placeholders})
          AND EXISTS (SELECT 1 FROM artifact_chunks c WHERE c.artifact_id = a.id)
        ORDER BY a.created_at`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });

  if (rows.length === 0) {
    console.log('[purge] no binary-kind artifacts have chunks. Nothing to do.');
    return;
  }

  console.log(`[purge] found ${rows.length} artifact(s) with binary kind + chunks:`);
  let totalChunks = 0;
  for (const r of rows) {
    totalChunks += r.CHUNK_COUNT;
    console.log(
      `  - ${r.ID}  kind=${r.KIND}  chunks=${r.CHUNK_COUNT}  title=${r.TITLE}`,
    );
  }
  console.log(`[purge] total chunks to delete: ${totalChunks}`);

  if (!apply) {
    console.log('[purge] dry run — re-run with --apply to actually delete.');
    return;
  }

  await withConnection(cfg, async (conn) => {
    for (const r of rows) {
      const del = await conn.execute(
        `DELETE FROM artifact_chunks WHERE artifact_id = :aid`,
        { aid: r.ID },
      );
      console.log(`  · ${r.ID}: deleted ${del.rowsAffected ?? 0} chunks`);
    }
    await conn.commit();
  });

  console.log('[purge] done. Artifact rows + Object Storage blobs left intact.');
}

main().catch((err) => {
  console.error('[purge] fatal:', err);
  process.exit(1);
});
