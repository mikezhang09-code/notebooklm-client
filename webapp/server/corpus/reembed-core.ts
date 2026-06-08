/**
 * Re-embed (backfill) core — shared by the `reembed.ts` CLI and the
 * `/api/corpus/reembed` route that powers the Diagnose → Search index panel.
 *
 * The heavy lifting: for a 0-chunk artifact, fetch its blob → extract text
 * (with Gemini OCR fallback for scanned PDFs/images) → chunk → embed
 * (SEARCH_DOCUMENT) → write chunk rows. Audio/video with no transcript yet
 * have no extractable text and are reported as 'no-text' — they get chunked
 * later by the transcription pipeline, not here.
 */
import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { getObjectBuffer } from './oci/storage.js';
import { embedTexts } from './oci/genai.js';
import { geminiExtractText, isOcrableMime } from './oci/gemini-ocr.js';
import { extract } from './extract/index.js';
import { chunkText } from './chunk.js';
import { newId } from './ulid.js';

/** A 0-chunk artifact row (or an explicitly targeted one). */
export interface Row {
  ID: string;
  TITLE: string;
  KIND: string;
  MIME_TYPE: string | null;
  OBJECT_NAME: string;
  CREATED_AT?: Date;
}

export type Status =
  | 'indexed'
  | 'would-index'
  | 'would-ocr'
  | 'no-text'
  | 'fetch-failed'
  | 'ocr-failed'
  | 'embed-failed';

export interface Outcome {
  status: Status;
  chunks?: number;
  chars?: number;
  error?: string;
  viaOcr?: boolean;
}

/**
 * Kinds that have no extractable text until a downstream step runs
 * (audio/video → transcription). These are 0-chunk *by design*, not a
 * failure, so the UI lists them separately and backfill skips them.
 */
const MEDIA_KINDS = new Set(['audio', 'video']);
export function isMediaKind(kind: string): boolean {
  return MEDIA_KINDS.has(kind);
}

/** Real mime for OCR: fall back to the filename when the DB has octet-stream. */
export function effectiveMime(mime: string | null, objectName: string): string | undefined {
  const m = (mime ?? '').toLowerCase();
  if (m && m !== 'application/octet-stream') return m;
  const ext = (objectName.split('.').pop() ?? '').toLowerCase();
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
  };
  return byExt[ext] ?? (m || undefined);
}

/** 0-chunk artifacts (or the explicit ids), newest first. */
export async function listTargets(cfg: CorpusConfig, ids: string[]): Promise<Row[]> {
  return withConnection(cfg, async (conn) => {
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `:id${i}`);
      const binds: Record<string, string> = {};
      ids.forEach((id, i) => (binds[`id${i}`] = id));
      const r = await conn.execute<Row>(
        `SELECT id, title, kind, mime_type, object_name, created_at
           FROM artifacts WHERE id IN (${placeholders.join(', ')})`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return r.rows ?? [];
    }
    const r = await conn.execute<Row>(
      `SELECT a.id, a.title, a.kind, a.mime_type, a.object_name, a.created_at
         FROM artifacts a
        WHERE NOT EXISTS (SELECT 1 FROM artifact_chunks c WHERE c.artifact_id = a.id)
        ORDER BY a.created_at DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });
}

/** Counts for the Diagnose → Search index panel. */
export interface IndexStatus {
  total: number;
  chunked: number;
  /** 0-chunk artifacts that backfill can index (text docs, PDFs, images). */
  fixable: number;
  /** 0-chunk audio/video awaiting transcription — not backfillable here. */
  media: number;
}

export async function getIndexStatus(cfg: CorpusConfig): Promise<IndexStatus> {
  return withConnection(cfg, async (conn) => {
    // Single-group aggregate over all artifacts, joined to a per-artifact chunk
    // count. cc.cnt IS NULL ⇒ the artifact has no chunks. (Avoid a scalar
    // subquery alongside aggregates — Oracle rejects that with ORA-00937.)
    const r = await conn.execute<{ TOTAL: number; UNCHUNKED: number; MEDIA: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN cc.cnt IS NULL THEN 1 ELSE 0 END) AS unchunked,
         SUM(CASE WHEN cc.cnt IS NULL AND a.kind IN ('audio','video') THEN 1 ELSE 0 END) AS media
         FROM artifacts a
         LEFT JOIN (
           SELECT artifact_id, COUNT(*) AS cnt
             FROM artifact_chunks
            GROUP BY artifact_id
         ) cc ON cc.artifact_id = a.id`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    const total = Number(row?.TOTAL ?? 0);
    const unchunked = Number(row?.UNCHUNKED ?? 0);
    const media = Number(row?.MEDIA ?? 0);
    return { total, chunked: total - unchunked, fixable: unchunked - media, media };
  });
}

/** The un-chunked list, split into the two groups the UI shows. */
export async function listUnchunked(
  cfg: CorpusConfig,
): Promise<{ fixable: Row[]; media: Row[] }> {
  const all = await listTargets(cfg, []);
  const fixable: Row[] = [];
  const media: Row[] = [];
  for (const row of all) (isMediaKind(row.KIND) ? media : fixable).push(row);
  return { fixable, media };
}

/**
 * Re-embed a single artifact. When `apply` is false this is a dry run that
 * reports what *would* happen without writing or making live OCR calls.
 */
export async function reembedOne(
  cfg: CorpusConfig,
  row: Row,
  apply: boolean,
): Promise<Outcome> {
  let buffer: Buffer;
  try {
    buffer = await getObjectBuffer(cfg, row.OBJECT_NAME);
  } catch (err) {
    return { status: 'fetch-failed', error: err instanceof Error ? err.message : String(err) };
  }

  // First try the plain text extractors (cheap). If they find nothing and the
  // file is a PDF/image, fall back to Gemini OCR.
  let text = await extract(buffer, row.MIME_TYPE ?? undefined, row.OBJECT_NAME);
  let viaOcr = false;
  if (text.trim().length === 0) {
    const mime = effectiveMime(row.MIME_TYPE, row.OBJECT_NAME);
    if (isOcrableMime(mime)) {
      if (!apply) return { status: 'would-ocr' };
      try {
        text = await geminiExtractText(cfg, buffer, mime!, row.TITLE);
        viaOcr = true;
      } catch (err) {
        return { status: 'ocr-failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
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

  return { status: 'indexed', chunks: chunks.length, chars: clean.length, viaOcr };
}
