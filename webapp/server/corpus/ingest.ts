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
  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `INSERT INTO artifacts
         (id, kind, origin, title, notebook_id, artifact_id,
          bucket, object_name, mime_type, size_bytes, tags, metadata)
       VALUES
         (:a_id, :a_kind, :a_origin, :a_title, :a_nb, :a_aid,
          :a_bucket, :a_obj, :a_mime, :a_sz, :a_tags, :a_meta)`,
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

  return {
    id,
    objectName,
    bucket: cfg.ociBucket,
    chunkCount: chunks.length,
    textPreview: rawText.slice(0, 200),
    sizeBytes: input.buffer.length,
  };
}
