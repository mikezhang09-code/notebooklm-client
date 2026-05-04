/**
 * Quick read-side verification script.
 *
 *   npx tsx server/corpus/verify-data.ts
 *
 * Counts rows, prints the latest artifact + chunk sample, and runs a
 * cosine-distance query using the first chunk's embedding as the probe
 * vector to confirm the VECTOR column + HNSW index are usable for search.
 */

import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection, closeDbPool } from './oci/db.js';

async function main(): Promise<number> {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('corpus disabled — cannot verify');
    return 1;
  }

  await withConnection(cfg, async (conn) => {
    const { rows: [[artifacts = 0] = []] = [] } = await conn.execute<number[]>(
      'SELECT COUNT(*) FROM artifacts',
    );
    const { rows: [[chunks = 0] = []] = [] } = await conn.execute<number[]>(
      'SELECT COUNT(*) FROM artifact_chunks',
    );
    console.log(`artifacts total: ${artifacts}, chunks total: ${chunks}`);

    const latest = await conn.execute<string[]>(
      `SELECT id, title, kind, size_bytes, created_at
         FROM artifacts ORDER BY created_at DESC FETCH FIRST 3 ROWS ONLY`,
    );
    console.log('\nlatest artifacts:');
    for (const row of latest.rows ?? []) console.log(' ', row);

    if (chunks === 0) return;

    // Probe kNN search: find the 3 chunks most similar to the first chunk's
    // own embedding — trivial self-match test, but proves the index is live.
    const probe = await conn.execute<{ ID: string; EMBEDDING: Float32Array }>(
      `SELECT id, embedding FROM artifact_chunks FETCH FIRST 1 ROWS ONLY`,
      {},
      { outFormat: 4002 /* OBJECT */ },
    );
    const first = probe.rows?.[0];
    if (!first) return;
    console.log(`\nprobe chunk id=${first.ID}, emb dims=${first.EMBEDDING?.length}`);

    const knn = await conn.execute<[string, number, string]>(
      `SELECT c.id,
              VECTOR_DISTANCE(c.embedding, :qv, COSINE) AS dist,
              SUBSTR(c.text, 1, 80) AS preview
         FROM artifact_chunks c
         ORDER BY dist
         FETCH FIRST 3 ROWS ONLY`,
      { qv: first.EMBEDDING } as unknown as oracledb.BindParameters,
    );
    console.log('\ntop-3 nearest chunks (should include self at dist≈0):');
    for (const row of knn.rows ?? []) {
      const [id, dist, preview] = row;
      console.log(`  ${id}  dist=${dist.toFixed(4)}  ${preview}`);
    }
  });

  await closeDbPool();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error('verify failed:', err);
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
