/**
 * Corpus ingest pipeline.
 *
 *   buffer + metadata
 *     ├── upload blob        → OCI Object Storage ({ulid}/{safe-filename})
 *     ├── extract text        → chunk → embed (SEARCH_DOCUMENT)
 *     └── DB tx: INSERT INTO artifacts + executeMany INTO artifact_chunks
 *
 * Returns the new artifact's ULID, canonical object name, and chunk count.
 * If any step throws, the caller gets a clean error; partial state in OCI
 * (orphan blob without DB row) is tolerable — we'll add a sweeper later.
 */

import oracledb from 'oracledb';
import { getCorpusConfig, type CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { putObject } from './oci/storage.js';
import { embedTexts } from './oci/genai.js';
import { extract } from './extract/index.js';
import { chunkText } from './chunk.js';
import { newId } from './ulid.js';

/** Allowed kinds — matches schema.sql's implicit contract. */
export type ArtifactKind =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flashcards'
  | 'infographic'
  | 'slides'
  | 'data_table'
  | 'upload';

export type ArtifactOrigin = 'notebooklm' | 'upload';

export interface IngestInput {
  buffer: Buffer;
  title: string;
  kind: ArtifactKind;
  origin: ArtifactOrigin;
  mimeType?: string;
  filename?: string;
  notebookId?: string;
  artifactId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  id: string;
  objectName: string;
  bucket: string;
  chunkCount: number;
  /** First ~200 chars of extracted text (debug / UI preview). */
  textPreview: string;
  /** Size of the raw blob uploaded, in bytes. */
  sizeBytes: number;
  /**
   * True iff this artifact was already in the corpus and we returned
   * the existing row without re-uploading / re-embedding.
   */
  alreadyIngested?: boolean;
}

/**
 * Look up an existing artifact by (notebook_id, artifact_id). Returns null
 * if there isn't one. Used for idempotent ingest — avoids a re-upload +
 * re-embed when a NotebookLM artifact is downloaded twice.
 */
async function findExistingByArtifactPair(
  cfg: CorpusConfig,
  notebookId: string,
  artifactId: string,
): Promise<{ id: string; objectName: string; chunkCount: number } | null> {
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute<{
      ID: string;
      OBJECT_NAME: string;
      CNT: number;
    }>(
      `SELECT a.id AS id, a.object_name AS object_name,
              (SELECT COUNT(*) FROM artifact_chunks c WHERE c.artifact_id = a.id) AS cnt
         FROM artifacts a
        WHERE a.notebook_id = :nb AND a.artifact_id = :aid
        FETCH FIRST 1 ROWS ONLY`,
      { nb: notebookId, aid: artifactId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return { id: row.ID, objectName: row.OBJECT_NAME, chunkCount: Number(row.CNT) };
  });
}

/**
 * Sanitise a filename for use inside an object key.
 * Replaces any non-[A-Za-z0-9._-] with '-', trims to 96 chars.
 */
function safeName(name: string | undefined, fallbackExt: string): string {
  const base = (name ?? `artifact.${fallbackExt}`)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[^A-Za-z0-9._\- ]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 96);
  return base.length > 0 ? base : `artifact.${fallbackExt}`;
}

function mimeToExt(mime: string | undefined): string {
  const m = (mime ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (
    m ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  if (m.startsWith('text/html')) return 'html';
  if (m.startsWith('text/markdown')) return 'md';
  if (m.startsWith('text/')) return 'txt';
  if (m.startsWith('audio/')) return 'mp3';
  if (m.startsWith('video/')) return 'mp4';
  if (m.startsWith('image/')) return m.split('/')[1] ?? 'bin';
  if (m === 'application/json') return 'json';
  return 'bin';
}

/**
 * Main entry point. Caller decides if the subsystem is enabled
 * (via `getCorpusConfig()`); `ingestArtifact` throws if called without
 * a live config.
 */
export async function ingestArtifact(input: IngestInput): Promise<IngestResult> {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    throw new Error(
      'Corpus is disabled (missing env vars); cannot ingest. See .env.example.',
    );
  }
  return ingestArtifactWith(cfg, input);
}

/**
 * Variant for callers that have already resolved config — avoids a double
 * lookup in tight loops (e.g. M3 backfill scripts).
 */
export async function ingestArtifactWith(
  cfg: CorpusConfig,
  input: IngestInput,
): Promise<IngestResult> {
  // 0) Idempotency: if this is a NotebookLM artifact with a (notebook, artifact)
  //    pair and we already have a matching row, short-circuit and reuse it.
  //    This makes the download-triggered auto-ingest safe to call repeatedly.
  if (input.origin === 'notebooklm' && input.notebookId && input.artifactId) {
    const existing = await findExistingByArtifactPair(
      cfg,
      input.notebookId,
      input.artifactId,
    );
    if (existing) {
      return {
        id: existing.id,
        objectName: existing.objectName,
        bucket: cfg.ociBucket,
        chunkCount: existing.chunkCount,
        textPreview: '',
        sizeBytes: input.buffer.length,
        alreadyIngested: true,
      };
    }
  }

  const id = newId();
  const ext = mimeToExt(input.mimeType);
  const fileSafe = safeName(input.filename, ext);
  const objectName = `${id}/${fileSafe}`;

  // 1) Extract text (synchronously — cheap for most inputs, <100ms even for PDFs).
  const rawText = await extract(input.buffer, input.mimeType, input.filename);
  const chunks = chunkText(rawText);

  // 2) Upload to Object Storage + embed chunks in parallel.
  //    (Both are network-bound; overlapping saves ~1-2s per ingest.)
  const [putResult, vectors] = await Promise.all([
    putObject(
      cfg,
      objectName,
      input.buffer,
      input.mimeType ?? 'application/octet-stream',
      input.buffer.length,
    ),
    chunks.length > 0
      ? embedTexts(
          cfg,
          chunks.map((c) => c.text),
          'SEARCH_DOCUMENT',
        )
      : Promise.resolve([] as number[][]),
  ]);
  void putResult;

  if (vectors.length !== chunks.length) {
    throw new Error(
      `embed count mismatch: ${vectors.length} vectors for ${chunks.length} chunks`,
    );
  }

  // 3) DB transaction: artifact + chunks.
  //    If two concurrent callers both passed idempotency check and then
  //    race to INSERT, the unique index on (notebook_id, artifact_id)
  //    will throw ORA-00001 on one of them. We catch that one case,
  //    re-read the winning row, and return it.
  try {
    await withConnection(cfg, async (conn) => {
    // M7: seed transcription_status='pending' for audio/video so the UI
    // has something to render immediately; the ingest hook flips it to
    // 'transcribing' after submitting the OCI Speech job.
    const isAudioVideo = input.kind === 'audio' || input.kind === 'video';
    const initialTrxStatus = isAudioVideo ? 'pending' : null;

    await conn.execute(
      `INSERT INTO artifacts
         (id, kind, origin, title, notebook_id, artifact_id,
          bucket, object_name, mime_type, size_bytes, tags, metadata,
          transcription_status)
       VALUES
         (:a_id, :a_kind, :a_origin, :a_title, :a_nb, :a_aid,
          :a_bucket, :a_obj, :a_mime, :a_sz, :a_tags, :a_meta,
          :a_trx)`,
      {
        a_id: id,
        a_kind: input.kind,
        a_origin: input.origin,
        a_title: input.title.slice(0, 512),
        a_nb: input.notebookId ?? null,
        a_aid: input.artifactId ?? null,
        a_bucket: cfg.ociBucket,
        a_obj: objectName,
        a_mime: input.mimeType ?? null,
        a_sz: input.buffer.length,
        a_tags: JSON.stringify(input.tags ?? []),
        a_meta: JSON.stringify(input.metadata ?? {}),
        a_trx: initialTrxStatus,
      },
      { autoCommit: false },
    );

    if (chunks.length > 0) {
      const rows = chunks.map((c, i) => ({
        cid: newId(),
        aid: id,
        ord: c.ordinal,
        txt: c.text,
        cs: c.charStart,
        ce: c.charEnd,
        tc: c.tokenEstimate,
        emb: Float32Array.from(vectors[i] as number[]),
      }));
      // Cast: @types/oracledb's BindParameters doesn't list Float32Array
      // among its value types, but oracledb itself accepts it for DB_TYPE_VECTOR.
      await conn.executeMany(
        `INSERT INTO artifact_chunks
           (id, artifact_id, ordinal, text, char_start, char_end, token_count, embedding)
         VALUES (:cid, :aid, :ord, :txt, :cs, :ce, :tc, :emb)`,
        rows as unknown as oracledb.BindParameters[],
        {
          bindDefs: {
            cid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
            aid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
            ord: { type: oracledb.DB_TYPE_NUMBER },
            // VARCHAR bind auto-converts to the CLOB column for chunks ≤ 32000 chars.
            txt: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 32000 },
            cs: { type: oracledb.DB_TYPE_NUMBER },
            ce: { type: oracledb.DB_TYPE_NUMBER },
            tc: { type: oracledb.DB_TYPE_NUMBER },
            emb: { type: oracledb.DB_TYPE_VECTOR },
          },
          autoCommit: false,
        },
      );
    }

    await conn.commit();
    });
  } catch (err) {
    // ORA-00001 = unique constraint violation. With our partial unique
    // index, this only happens on a (notebook_id, artifact_id) collision
    // from a concurrent ingest — treat it as a successful "already there".
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /ORA-00001/i.test(msg) &&
      input.origin === 'notebooklm' &&
      input.notebookId &&
      input.artifactId
    ) {
      const winner = await findExistingByArtifactPair(
        cfg,
        input.notebookId,
        input.artifactId,
      );
      if (winner) {
        return {
          id: winner.id,
          objectName: winner.objectName,
          bucket: cfg.ociBucket,
          chunkCount: winner.chunkCount,
          textPreview: rawText.slice(0, 200),
          sizeBytes: input.buffer.length,
          alreadyIngested: true,
        };
      }
    }
    throw err;
  }

  // M7: fire-and-forget transcription enqueue for audio/video. Any error
  // inside enqueueTranscription updates the row to 'failed'; we don't want
  // ingest itself to fail just because Speech is temporarily unavailable.
  if (input.kind === 'audio' || input.kind === 'video') {
    // Dynamic import avoids a circular-import risk (transcribe.ts imports
    // from ./oci/* which ingest.ts also imports).
    void (async () => {
      try {
        const { enqueueTranscription } = await import('./transcribe.js');
        await enqueueTranscription(cfg, id);
      } catch (err) {
        console.warn(
          `[ingest] transcription enqueue failed for ${id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();
  }

  return {
    id,
    objectName,
    bucket: cfg.ociBucket,
    chunkCount: chunks.length,
    textPreview: rawText.slice(0, 200),
    sizeBytes: input.buffer.length,
  };
}
