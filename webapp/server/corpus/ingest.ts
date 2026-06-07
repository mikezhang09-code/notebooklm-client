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
  | 'mind'
  | 'upload'
  | 'note'
  | 'qa';

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
  /** Optional collection to file this upload under (NULL = free-form). */
  collectionId?: string;
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
  /**
   * True iff embeddings could not be generated (e.g. Gemini quota 429), so the
   * artifact was stored WITHOUT chunks — it's viewable/downloadable but not yet
   * searchable. Re-embed later (npm run reembed) to index it.
   */
  embedSkipped?: boolean;
  /** The embedding error message, when embedSkipped is true. */
  embedError?: string;
}

/**
 * Embed chunks, but never throw: on failure (e.g. quota 429) return an empty
 * vector set + the error so callers can store the artifact without chunks
 * instead of failing the whole upload.
 */
async function safeEmbed(
  cfg: CorpusConfig,
  texts: string[],
): Promise<{ vectors: number[][]; error?: string }> {
  if (texts.length === 0) return { vectors: [] };
  try {
    const vectors = await embedTexts(cfg, texts, 'SEARCH_DOCUMENT');
    return { vectors };
  } catch (err) {
    return { vectors: [], error: err instanceof Error ? err.message : String(err) };
  }
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
  //    Embedding is resilient: if it fails (e.g. Gemini quota 429) we still
  //    store the artifact — just without chunks (not searchable until re-embed).
  const [putResult, embed] = await Promise.all([
    putObject(
      cfg,
      objectName,
      input.buffer,
      input.mimeType ?? 'application/octet-stream',
      input.buffer.length,
    ),
    safeEmbed(cfg, chunks.map((c) => c.text)),
  ]);
  void putResult;

  const vectors = embed.vectors;
  const storeChunks = !embed.error && vectors.length === chunks.length && chunks.length > 0;
  if (embed.error) {
    console.warn(`[corpus] embedding failed — storing ${input.kind} without chunks: ${embed.error}`);
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
         (id, kind, origin, title, notebook_id, artifact_id, collection_id,
          bucket, object_name, mime_type, size_bytes, tags, metadata,
          transcription_status)
       VALUES
         (:a_id, :a_kind, :a_origin, :a_title, :a_nb, :a_aid, :a_col,
          :a_bucket, :a_obj, :a_mime, :a_sz, :a_tags, :a_meta,
          :a_trx)`,
      {
        a_id: id,
        a_kind: input.kind,
        a_origin: input.origin,
        a_title: input.title.slice(0, 512),
        a_nb: input.notebookId ?? null,
        a_aid: input.artifactId ?? null,
        a_col: input.collectionId ?? null,
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

    if (storeChunks) {
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
    chunkCount: storeChunks ? chunks.length : 0,
    textPreview: rawText.slice(0, 200),
    sizeBytes: input.buffer.length,
    ...(embed.error ? { embedSkipped: true, embedError: embed.error } : {}),
  };
}

// ────────────────────────────────────────── saved NotebookLM chats (qa) ──

/** One turn of a saved NotebookLM conversation. */
export interface SavedChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Inline citation records from NotebookLM (assistant turns only). */
  citations?: Array<{ index: number; excerpt: string; sourceId: string | null }>;
}

export interface SaveChatArtifactInput {
  /** NotebookLM notebook the conversation was against. */
  notebookId: string;
  /** Human-friendly notebook name; stored in metadata + the markdown body. */
  notebookTitle: string;
  /**
   * Client-minted UUID that identifies this conversation across re-saves.
   * On re-save with the same sessionId, the existing artifact is updated
   * in place (chunks deleted + re-embedded + object overwritten) rather
   * than duplicated.
   */
  sessionId: string;
  /** User-edited title; truncated to 512 chars before insert. */
  title: string;
  /** Ordered turns, oldest → newest. Must have at least one user turn. */
  turns: SavedChatTurn[];
}

export interface SaveChatArtifactResult {
  id: string;
  sessionId: string;
  chunkCount: number;
  /** True iff a new row was created; false if an existing row was updated. */
  created: boolean;
}

/**
 * Render a saved conversation as markdown. Uses `## You` / `## NotebookLM`
 * headings so the ingest chunker (which is paragraph/heading-aware) splits
 * cleanly at turn boundaries — each turn becomes its own chunk or two,
 * which means later retrieval can cite individual turns, not the whole
 * thread.
 */
function renderSavedChatMarkdown(
  title: string,
  notebookTitle: string,
  turns: SavedChatTurn[],
): string {
  const when = new Date().toISOString();
  const turnWord = turns.length === 1 ? 'turn' : 'turns';
  const parts: string[] = [
    `# ${title}`,
    '',
    `*Saved from NotebookLM chat · ${notebookTitle} · ${when} · ${turns.length} ${turnWord}*`,
    '',
  ];
  for (const t of turns) {
    const speaker = t.role === 'user' ? 'You' : 'NotebookLM';
    parts.push(`## ${speaker}`);
    parts.push('');
    parts.push(t.content.trim());
    parts.push('');
    if (t.role === 'assistant' && t.citations && t.citations.length > 0) {
      parts.push('**Citations**');
      parts.push('');
      for (const c of t.citations) {
        const excerpt = c.excerpt.replace(/\s+/g, ' ').trim();
        parts.push(`- [${c.index}] ${excerpt}`);
      }
      parts.push('');
    }
  }
  return parts.join('\n');
}

/**
 * Upsert a saved NotebookLM chat conversation as a `kind='qa'` corpus
 * artifact.
 *
 *   ── idempotency model ─────────────────────────────────────────────────
 *   We reuse the existing (origin, notebook_id, artifact_id) uniqueness
 *   contract by synthesising `artifact_id = 'chat:<sessionId>'`. On the
 *   first save we INSERT; on subsequent saves with the same sessionId we
 *   UPDATE the row, delete + reinsert chunks, and overwrite the OCI
 *   object. The sessionId is minted client-side on first save and kept
 *   in component state, so mid-conversation saves and end-of-conversation
 *   saves collapse into a single artifact.
 *
 *   ── why we don't go through ingestArtifactWith ────────────────────────
 *   Three reasons:
 *     1. We already have the text content (we rendered it). Round-tripping
 *        through extract() + mime detection is pointless overhead.
 *     2. The existing idempotency path in ingestArtifactWith is a SKIP,
 *        not an UPDATE. For saved chats we want the opposite semantic.
 *     3. Saved chats don't run through the M7 transcription enqueue —
 *        they aren't audio/video. Keeping the code path separate avoids
 *        future entanglement.
 */
export async function saveChatArtifact(
  cfg: CorpusConfig,
  input: SaveChatArtifactInput,
): Promise<SaveChatArtifactResult> {
  if (!input.notebookId) throw new Error('notebookId is required');
  if (!input.sessionId) throw new Error('sessionId is required');
  if (!input.title?.trim()) throw new Error('title is required');
  if (!input.turns || input.turns.length === 0) {
    throw new Error('at least one turn is required');
  }

  const syntheticArtifactId = `chat:${input.sessionId}`;
  const title = input.title.slice(0, 512);

  // 1) Render + chunk the markdown body.
  const md = renderSavedChatMarkdown(title, input.notebookTitle, input.turns);
  const buffer = Buffer.from(md, 'utf8');
  const chunks = chunkText(md);

  // 2) Look up an existing row for this conversation.
  const existing = await findExistingByArtifactPair(
    cfg,
    input.notebookId,
    syntheticArtifactId,
  );
  const artifactId = existing?.id ?? newId();
  const objectName = existing?.objectName ?? `${artifactId}/chat.md`;

  // 3) Build metadata blob (stored verbatim in the artifacts.metadata
  //    JSON column — powers the library drawer + future analytics).
  const firstUserTurn = input.turns.find((t) => t.role === 'user');
  const metadata = {
    sessionId: input.sessionId,
    notebookTitle: input.notebookTitle,
    turnCount: input.turns.length,
    firstQuestion: (firstUserTurn?.content ?? '').slice(0, 200),
    lastSavedAt: new Date().toISOString(),
  };

  // 4) Upload + embed in parallel — both are network-bound, overlapping
  //    shaves ~0.5–1s off the end-to-end save. Matches the optimisation
  //    in ingestArtifactWith.
  //
  //    NB: the `charset=utf-8` suffix is load-bearing. Without it browsers
  //    opening the PAR URL fall back to a locale-dependent default
  //    (Windows-1252 / GBK on a zh-CN system) and mojibake every non-ASCII
  //    character, even though the bytes on disk are pure UTF-8. Seen in
  //    practice with Chinese prompts saved from the Chat page.
  const chatMime = 'text/markdown; charset=utf-8';
  const [, embed] = await Promise.all([
    putObject(cfg, objectName, buffer, chatMime, buffer.length),
    safeEmbed(cfg, chunks.map((c) => c.text)),
  ]);
  const vectors = embed.vectors;
  const storeChunks = !embed.error && vectors.length === chunks.length && chunks.length > 0;
  if (embed.error) {
    console.warn(`[corpus] embedding failed on saved chat — storing without chunks: ${embed.error}`);
  }

  // 5) DB transaction: upsert artifact row + replace chunks.
  await withConnection(cfg, async (conn) => {
    if (existing) {
      await conn.execute(
        `UPDATE artifacts
            SET title      = :t,
                size_bytes = :sz,
                metadata   = :m,
                updated_at = SYSTIMESTAMP
          WHERE id = :id`,
        {
          id: artifactId,
          t: title,
          sz: buffer.length,
          m: JSON.stringify(metadata),
        },
        { autoCommit: false },
      );
      await conn.execute(
        `DELETE FROM artifact_chunks WHERE artifact_id = :aid`,
        { aid: artifactId },
        { autoCommit: false },
      );
    } else {
      await conn.execute(
        `INSERT INTO artifacts
           (id, kind, origin, title, notebook_id, artifact_id,
            bucket, object_name, mime_type, size_bytes, tags, metadata)
         VALUES
           (:a_id, 'qa', 'notebooklm', :a_title, :a_nb, :a_aid,
            :a_bucket, :a_obj, :a_mime, :a_sz, :a_tags, :a_meta)`,
        {
          a_id: artifactId,
          a_title: title,
          a_nb: input.notebookId,
          a_aid: syntheticArtifactId,
          a_bucket: cfg.ociBucket,
          a_obj: objectName,
          a_mime: chatMime,
          a_sz: buffer.length,
          a_tags: JSON.stringify(['chat']),
          a_meta: JSON.stringify(metadata),
        },
        { autoCommit: false },
      );
    }

    if (storeChunks) {
      const rows = chunks.map((c, i) => ({
        cid: newId(),
        aid: artifactId,
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
        rows as unknown as oracledb.BindParameters[],
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
    }

    await conn.commit();
  });

  return {
    id: artifactId,
    sessionId: input.sessionId,
    chunkCount: storeChunks ? chunks.length : 0,
    created: !existing,
  };
}

// ───────────────────────────────────────────── edit a text artifact (notes) ──

/**
 * Replace the text content of an existing artifact (notes + markdown reports).
 * Overwrites its Object Storage blob in place, re-chunks + re-embeds, and
 * swaps the chunk rows. Used by the in-app markdown editor.
 */
export async function updateArtifactText(
  cfg: CorpusConfig,
  id: string,
  input: { title?: string; markdown: string },
): Promise<{ id: string; chunkCount: number; embedSkipped?: boolean; embedError?: string }> {
  const row = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<{ OBJECT_NAME: string; MIME_TYPE: string | null }>(
      `SELECT object_name, mime_type FROM artifacts WHERE id = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows?.[0];
  });
  if (!row) throw new Error('artifact not found');

  const objectName = row.OBJECT_NAME;
  const mime = row.MIME_TYPE ?? 'text/markdown; charset=utf-8';
  const buffer = Buffer.from(input.markdown, 'utf8');
  const chunks = chunkText(input.markdown);

  const [, embed] = await Promise.all([
    putObject(cfg, objectName, buffer, mime, buffer.length),
    safeEmbed(cfg, chunks.map((c) => c.text)),
  ]);
  const vectors = embed.vectors;
  const storeChunks = !embed.error && vectors.length === chunks.length && chunks.length > 0;
  if (embed.error) {
    console.warn(`[corpus] embedding failed on update — keeping content without chunks: ${embed.error}`);
  }

  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `UPDATE artifacts
          SET title = COALESCE(:t, title), size_bytes = :sz, updated_at = SYSTIMESTAMP
        WHERE id = :id`,
      { t: input.title?.slice(0, 512) ?? null, sz: buffer.length, id },
      { autoCommit: false },
    );
    await conn.execute(`DELETE FROM artifact_chunks WHERE artifact_id = :aid`, { aid: id }, { autoCommit: false });
    if (storeChunks) {
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
    chunkCount: storeChunks ? chunks.length : 0,
    ...(embed.error ? { embedSkipped: true, embedError: embed.error } : {}),
  };
}
