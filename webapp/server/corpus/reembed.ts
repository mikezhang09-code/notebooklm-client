/**
 * Re-index artifacts that have no chunks.
 *
 * For each 0-chunk artifact: fetch its blob from Object Storage → extract text
 * → chunk → embed (SEARCH_DOCUMENT) → insert chunk rows. Fixes documents that
 * were stored without an index (e.g. an embedding 429 at ingest time, or a
 * transient extraction failure). Docs with no extractable text (scanned/image
 * PDFs, media) are reported as 'no-text' and left untouched.
 *
 * Usage (from webapp/):
 *   npx tsx server/corpus/reembed.ts                 # dry run — list 0-chunk docs
 *   npx tsx server/corpus/reembed.ts --apply         # extract + embed + write
 *   npx tsx server/corpus/reembed.ts --apply <id>... # only the given artifact ids
 */
import oracledb from 'oracledb';
import { getCorpusConfig, type CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { getObjectBuffer } from './oci/storage.js';
import { embedTexts } from './oci/genai.js';
import { extract } from './extract/index.js';
import { chunkText } from './chunk.js';
import { newId } from './ulid.js';

interface Row {
  ID: string;
  TITLE: string;
  MIME_TYPE: string | null;
  OBJECT_NAME: string;
}

type Status = 'indexed' | 'would-index' | 'no-text' | 'fetch-failed' | 'embed-failed';
interface Outcome {
  status: Status;
  chunks?: number;
  chars?: number;
  error?: string;
}

/** 0-chunk artifacts (or the explicit ids), newest first. */
async function listTargets(cfg: CorpusConfig, ids: string[]): Promise<Row[]> {
  return withConnection(cfg, async (conn) => {
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `:id${i}`);
      const binds: Record<string, string> = {};
      ids.forEach((id, i) => (binds[`id${i}`] = id));
      const r = await conn.execute<Row>(
        `SELECT id, title, mime_type, object_name
           FROM artifacts WHERE id IN (${placeholders.join(', ')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return r.rows ?? [];
    }
    const r = await conn.execute<Row>(
      `SELECT a.id, a.title, a.mime_type, a.object_name
         FROM artifacts a
        WHERE NOT EXISTS (SELECT 1 FROM artifact_chunks c WHERE c.artifact_id = a.id)
        ORDER BY a.created_at DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });
}

async function reembedOne(cfg: CorpusConfig, row: Row, apply: boolean): Promise<Outcome> {
  let text = '';
  try {
    const buffer = await getObjectBuffer(cfg, row.OBJECT_NAME);
    text = await extract(buffer, row.MIME_TYPE ?? undefined, row.OBJECT_NAME);
  } catch (err) {
    return { status: 'fetch-failed', error: err instanceof Error ? err.message : String(err) };
  }

  const clean = text.trim();
  const chunks = clean ? chunkText(text) : [];
  if (chunks.length === 0) return { status: 'no-text', chars: clean.length };
  if (!apply) return { status: 'would-index', chunks: chunks.length, chars: clean.length };

  let vectors: number[][];
  try {
    vectors = await embedTexts(cfg, chunks.map((c) => c.text), 'SEARCH_DOCUMENT');
  } catch (err) {
    return { status: 'embed-failed', error: err instanceof Error ? err.message : String(err) };
  }
  if (vectors.length !== chunks.length) {
    return { status: 'embed-failed', error: `got ${vectors.length} vectors for ${chunks.length} chunks` };
  }

  await withConnection(cfg, async (conn) => {
    // Defensive: clear any partial chunk rows before reinserting.
    await conn.execute(`DELETE FROM artifact_chunks WHERE artifact_id = :aid`, { aid: row.ID }, { autoCommit: false });
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
        autoCommit: false,
      },
    );
    await conn.commit();
  });

  return { status: 'indexed', chunks: chunks.length, chars: clean.length };
}

async function main() {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('Corpus is disabled (missing env). Cannot re-embed.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((a) => !a.startsWith('--'));

  const targets = await listTargets(cfg, ids);
  if (targets.length === 0) {
    console.log('Nothing to re-embed — no matching artifacts found.');
    return;
  }
  console.log(
    `${apply ? 'Re-embedding' : 'DRY RUN —'} ${targets.length} artifact(s)` +
      (apply ? '' : ' (pass --apply to write):') + '\n',
  );

  const tally: Record<Status, number> = {
    indexed: 0, 'would-index': 0, 'no-text': 0, 'fetch-failed': 0, 'embed-failed': 0,
  };
  for (const row of targets) {
    const o = await reembedOne(cfg, row, apply);
    tally[o.status]++;
    const detail =
      o.status === 'indexed' || o.status === 'would-index'
        ? `${o.chunks} chunks, ${o.chars} chars`
        : o.status === 'no-text'
          ? 'no extractable text (scanned/image/media)'
          : o.error ?? '';
    console.log(`  [${o.status.padEnd(12)}] ${row.TITLE} — ${detail}`);
  }

  console.log(
    `\nSummary: ${tally.indexed} indexed, ${tally['would-index']} would-index, ` +
      `${tally['no-text']} no-text, ${tally['fetch-failed']} fetch-failed, ${tally['embed-failed']} embed-failed`,
  );
  if (!apply && tally['would-index'] > 0) console.log('Re-run with --apply to index them.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FATAL:', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  },
);
