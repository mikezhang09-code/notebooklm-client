import 'dotenv/config';
import oracledb from 'oracledb';
import { getCorpusConfig } from '../server/corpus/config.js';
import { withConnection } from '../server/corpus/oci/db.js';
import { getObjectBuffer } from '../server/corpus/oci/storage.js';
import { embedTexts } from '../server/corpus/oci/genai.js';
import { extract } from '../server/corpus/extract/index.js';
import { chunkText } from '../server/corpus/chunk.js';
import { newId } from '../server/corpus/ulid.js';

async function main() {
  console.log('Loading configuration...');
  const cfg = await getCorpusConfig();
  if (!cfg) throw new Error('No corpus configuration found in .env');

  await withConnection(cfg, async (conn) => {
    console.log('Finding artifacts with missing chunks...');
    const result = await conn.execute<{
      ID: string;
      OBJECT_NAME: string;
      MIME_TYPE: string;
      TITLE: string;
    }>(
      `SELECT a.id, a.object_name, a.mime_type, a.title 
       FROM artifacts a 
       LEFT JOIN artifact_chunks c ON a.id = c.artifact_id 
       WHERE c.id IS NULL 
       GROUP BY a.id, a.object_name, a.mime_type, a.title`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let rows = result.rows || [];
    // Optional `--limit N` to test a few artifacts before doing the whole corpus.
    const limitArg = process.argv.indexOf('--limit');
    if (limitArg !== -1) {
      const n = parseInt(process.argv[limitArg + 1] ?? '', 10);
      if (Number.isFinite(n) && n > 0) {
        rows = rows.slice(0, n);
        console.log(`(--limit ${n}) processing first ${rows.length} artifacts only.`);
      }
    }
    console.log(`Found ${result.rows?.length ?? 0} artifacts missing chunks; processing ${rows.length}.`);

    for (const row of rows) {
      console.log(`\nRe-embedding: ${row.TITLE}`);
      try {
        // Use the object's real filename (carries the .pdf/.md/.png extension)
        // for extractor selection — the title often has no extension, which
        // would mis-route binary files (e.g. an infographic .png) into the text
        // extractor and produce megabytes of garbage "text".
        const filename = row.OBJECT_NAME.split('/').pop() || row.TITLE;
        const { pickExtractor } = await import('../server/corpus/extract/index.js');
        const extractor = pickExtractor(row.MIME_TYPE, filename);
        if (extractor.name === 'extractEmpty') {
          console.log(`  -> Skipping: non-text file (${filename})`);
          continue;
        }

        console.log(`  -> Fetching from OCI: ${row.OBJECT_NAME}`);
        const buffer = await getObjectBuffer(cfg, row.OBJECT_NAME);
        console.log(`  -> Got buffer of ${buffer.length} bytes. Extracting text...`);
        const rawText = await extract(buffer, row.MIME_TYPE, filename);
        console.log(`  -> Extracted ${rawText.length} characters. Chunking...`);
        const chunks = chunkText(rawText);

        if (chunks.length === 0) {
          console.log(`  -> No text could be extracted.`);
          continue;
        }

        let vectors: number[][] = [];
        let retries = 0;
        const MAX_RETRIES = 10;
        while (retries < MAX_RETRIES) {
          try {
            console.log(`  -> Generating ${chunks.length} vectors via ${cfg.embeddingProvider} (Attempt ${retries + 1})...`);
            vectors = await embedTexts(cfg, chunks.map(c => c.text), 'SEARCH_DOCUMENT');
            break; // Success!
          } catch (e: any) {
            if (e.message && e.message.includes('429')) {
              const wait = 30000 + retries * 5000; // 30s, 35s, 40s … backoff
              console.log(`  -> Rate limited! Sleeping for ${wait / 1000}s (retry ${retries + 1}/${MAX_RETRIES})...`);
              await new Promise(r => setTimeout(r, wait));
              retries++;
            } else {
              throw e;
            }
          }
        }

        if (vectors.length === 0) {
          throw new Error('Failed to embed after multiple retries due to rate limits.');
        }

        const insertRows = chunks.map((c, i) => ({
          cid: newId(),
          aid: row.ID,
          ord: c.ordinal,
          txt: c.text,
          cs: c.charStart,
          ce: c.charEnd,
          tc: c.tokenEstimate,
          emb: Float32Array.from(vectors[i] as number[]),
        }));

        await conn.executeMany(
          `INSERT INTO artifact_chunks
             (id, artifact_id, ordinal, text, char_start, char_end, token_count, embedding)
           VALUES (:cid, :aid, :ord, :txt, :cs, :ce, :tc, :emb)`,
          insertRows as unknown as oracledb.BindParameters[],
          {
            bindDefs: {
              cid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
              aid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
              ord: { type: oracledb.DB_TYPE_NUMBER },
              txt: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 32000 },
              cs: { type: oracledb.DB_TYPE_NUMBER },
              ce: { type: oracledb.DB_TYPE_NUMBER },
              tc: { type: oracledb.DB_TYPE_NUMBER },
              emb: { type: oracledb.DB_TYPE_VECTOR },
            },
            autoCommit: true,
          }
        );
        console.log(`  -> Inserted ${chunks.length} chunks successfully!`);
        // Pace between artifacts to respect the provider's RPM limit. Voyage's
        // free tier without a payment method is only ~3 RPM; override with
        // `--sleep <seconds>`.
        const sleepArg = process.argv.indexOf('--sleep');
        const sleepSec = sleepArg !== -1 ? parseInt(process.argv[sleepArg + 1] ?? '', 10) : 6;
        const sleepMs = (Number.isFinite(sleepSec) && sleepSec >= 0 ? sleepSec : 6) * 1000;
        console.log(`  -> Sleeping ${sleepMs / 1000}s to pace requests...`);
        await new Promise(r => setTimeout(r, sleepMs));
      } catch (err) {
        console.error(`  -> Failed to process ${row.TITLE}:`, err);
      }
    }
  });

  console.log('\nAll missing documents processed successfully.');
}

main().catch(console.error);
