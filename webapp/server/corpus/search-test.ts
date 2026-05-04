/**
 * Ad-hoc semantic search probe.
 *
 *   npx tsx server/corpus/search-test.ts "your query"
 *
 * Embeds the query with SEARCH_QUERY input type and finds the top-5 closest
 * chunks by cosine distance, joined back to their parent artifact metadata.
 */

import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection, closeDbPool } from './oci/db.js';
import { embedTexts } from './oci/genai.js';

async function main(): Promise<number> {
  const query = process.argv.slice(2).join(' ').trim() || 'gaming revenue growth';
  console.log(`query: "${query}"`);

  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('corpus disabled');
    return 1;
  }

  const [qvec] = await embedTexts(cfg, [query], 'SEARCH_QUERY');
  if (!qvec) {
    console.error('empty query embedding');
    return 1;
  }
  const qv = Float32Array.from(qvec);
  console.log(`query embedding dims=${qv.length}`);

  await withConnection(cfg, async (conn) => {
    const result = await conn.execute<[string, string, string, number, string]>(
      `SELECT a.id              AS artifact_id,
              a.title           AS title,
              a.kind            AS kind,
              VECTOR_DISTANCE(c.embedding, :qv, COSINE) AS dist,
              SUBSTR(c.text, 1, 160) AS preview
         FROM artifact_chunks c
         JOIN artifacts a ON a.id = c.artifact_id
         ORDER BY dist
         FETCH FIRST 5 ROWS ONLY`,
      { qv } as unknown as oracledb.BindParameters,
    );
    console.log('\ntop-5 chunks:');
    for (const row of result.rows ?? []) {
      const [aid, title, kind, dist, preview] = row;
      console.log(
        `  dist=${dist.toFixed(4)}  [${kind}] ${title} (${aid})\n    ${preview.replace(/\s+/g, ' ').slice(0, 140)}`,
      );
    }
  });

  await closeDbPool();
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch(async (err) => {
    console.error('search failed:', err);
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
