/**
 * Corpus REST routes.
 *
 * M1: /health
 * M2: /ingest (multipart upload) + /artifacts (list)
 * M3: /search (semantic), /artifacts/:id (detail + PAR download link)
 * M5: PATCH /artifacts/:id (title/tags), DELETE /artifacts/:id,
 *     POST /artifacts/:id/share (long-lived PAR)
 * M6: POST /chat (RAG over corpus)
 * M7: POST /artifacts/:id/transcribe (retry transcription for audio/video)
 */

import { Router } from 'express';
import multer from 'multer';
import oracledb from 'oracledb';
import { asyncHandler } from '../lib/handler.js';
import {
  corpusHealth,
  getCorpusConfig,
  withConnection,
  createReadPar,
  deleteObject,
  searchCorpus,
  chatCorpus,
  type ChatTurn,
  retryTranscription,
} from '../corpus/index.js';
import {
  ingestArtifact,
  saveChatArtifact,
  type ArtifactKind,
  type ArtifactOrigin,
  type SavedChatTurn,
} from '../corpus/ingest.js';

export const corpusRouter = Router();

// Buffer uploads in memory — max 100 MB to match sources/generate routes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const ALLOWED_KINDS: ArtifactKind[] = [
  'audio',
  'report',
  'video',
  'quiz',
  'flashcards',
  'infographic',
  'slides',
  'data_table',
  'upload',
  'qa',
];
const ALLOWED_ORIGINS: ArtifactOrigin[] = ['notebooklm', 'upload'];

/**
 * GET /api/corpus/health
 *
 * Returns a JSON object showing the status of each OCI service. Always
 * 200, even if individual services fail — the body tells the truth.
 *
 * Example healthy response:
 * {
 *   "enabled": true,
 *   "region": "ap-tokyo-1",
 *   "bucket": "nblm-corpus",
 *   "db":      { "ok": true, "version": "Oracle Database 26ai ...", "user": "CORPUS" },
 *   "storage": { "ok": true, "bucket": "nblm-corpus", "approxObjectCount": 0 },
 *   "genai":   { "ok": true, "model": "cohere.embed-multilingual-v3.0", "dimensions": 1024 }
 * }
 */
corpusRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const health = await corpusHealth();
    res.json(health);
  }),
);

/**
 * POST /api/corpus/ingest  — multipart/form-data
 *
 * Fields:
 *   file      (required)  the blob to store + index
 *   title     (required)  display name
 *   kind      (required)  audio|report|video|quiz|flashcards|infographic|slides|data_table|upload
 *   origin    (optional)  notebooklm|upload (default: upload)
 *   notebookId, artifactId  (optional) NotebookLM linkage
 *   tags      (optional)  JSON array string, e.g. ["q2-earnings","tencent"]
 *   metadata  (optional)  JSON object string with kind-specific extras
 */
corpusRouter.post(
  '/ingest',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'missing "file" field' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const title = body['title']?.trim();
    const kindRaw = body['kind']?.trim() as ArtifactKind | undefined;
    const originRaw = (body['origin']?.trim() ?? 'upload') as ArtifactOrigin;
    if (!title || title.length === 0) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!kindRaw || !ALLOWED_KINDS.includes(kindRaw)) {
      res.status(400).json({ error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` });
      return;
    }
    if (!ALLOWED_ORIGINS.includes(originRaw)) {
      res.status(400).json({ error: `origin must be one of: ${ALLOWED_ORIGINS.join(', ')}` });
      return;
    }
    let tags: string[] | undefined;
    if (body['tags']) {
      try {
        const parsed = JSON.parse(body['tags']);
        if (!Array.isArray(parsed)) throw new Error('tags must be a JSON array');
        tags = parsed.map((t) => String(t));
      } catch (err) {
        res.status(400).json({ error: `invalid tags: ${(err as Error).message}` });
        return;
      }
    }
    let metadata: Record<string, unknown> | undefined;
    if (body['metadata']) {
      try {
        const parsed = JSON.parse(body['metadata']);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('metadata must be a JSON object');
        }
        metadata = parsed as Record<string, unknown>;
      } catch (err) {
        res.status(400).json({ error: `invalid metadata: ${(err as Error).message}` });
        return;
      }
    }

    const result = await ingestArtifact({
      buffer: file.buffer,
      title,
      kind: kindRaw,
      origin: originRaw,
      mimeType: file.mimetype,
      filename: file.originalname,
      notebookId: body['notebookId'] || undefined,
      artifactId: body['artifactId'] || undefined,
      tags,
      metadata,
    });
    res.status(201).json(result);
  }),
);

/**
 * GET /api/corpus/artifacts
 *
 * Query params:
 *   kind       (optional)  filter by a single kind
 *   origin     (optional)  filter by origin
 *   notebookId (optional)  filter by notebook linkage
 *   limit      (optional)  default 50, max 200
 *   offset     (optional)  default 0
 *
 * Returns `{ items: [...], total, limit, offset }`. Ordered by created_at DESC.
 */
corpusRouter.get(
  '/artifacts',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(parseInt(q['limit'] ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(q['offset'] ?? '0', 10) || 0, 0);

    const whereClauses: string[] = [];
    // Keep filter binds separate from pagination binds — oracledb Thin
    // rejects "extra" bind parameters that a query doesn't reference.
    const filterBinds: Record<string, string | number> = {};
    if (q['kind']) {
      whereClauses.push('kind = :kind');
      filterBinds['kind'] = q['kind'];
    }
    if (q['origin']) {
      whereClauses.push('origin = :origin');
      filterBinds['origin'] = q['origin'];
    }
    if (q['notebookId']) {
      whereClauses.push('notebook_id = :nb');
      filterBinds['nb'] = q['notebookId'];
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const listBinds = { ...filterBinds, lim: limit, off: offset };

    const { items, total } = await withConnection(cfg, async (conn) => {
      const listSql = `
        SELECT id, kind, origin, title, notebook_id, artifact_id,
               bucket, object_name, mime_type, size_bytes, tags, metadata,
               created_at,
               transcription_status, transcription_job_ocid,
               transcribed_at, transcription_error,
               (SELECT COUNT(*) FROM artifact_chunks c WHERE c.artifact_id = a.id) AS chunk_count
          FROM artifacts a
          ${where}
          ORDER BY created_at DESC
          OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`;
      // OUT_FORMAT_OBJECT keeps column names as uppercase keys so the
      // client sees `ID`, `KIND`, `OBJECT_NAME`, ... instead of tuples.
      const listResult = await conn.execute<Record<string, unknown>>(listSql, listBinds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      const countResult = await conn.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS cnt FROM artifacts a ${where}`,
        filterBinds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return {
        items: listResult.rows ?? [],
        total: countResult.rows?.[0]?.CNT ?? 0,
      };
    });

    res.json({ items, total, limit, offset });
  }),
);

/**
 * GET /api/corpus/artifacts/:id
 *
 * Returns the full artifact row plus a short-lived PAR URL
 * (`downloadUrl`, valid ~1h) so the caller can fetch the blob directly
 * from Object Storage without the server proxying bytes.
 */
corpusRouter.get(
  '/artifacts/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const id = req.params['id'];
    if (!id || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) {
      res.status(400).json({ error: 'invalid artifact id' });
      return;
    }
    const row = await withConnection(cfg, async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT id, kind, origin, title, notebook_id, artifact_id, bucket,
                object_name, mime_type, size_bytes, tags, metadata, created_at,
                transcription_status, transcription_job_ocid,
                transcribed_at, transcription_error
           FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows?.[0];
    });
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    const r = row as unknown as Record<string, unknown>;
    const objectName = r['OBJECT_NAME'] ?? (r as { objectName?: string }).objectName;
    if (typeof objectName !== 'string') {
      res.status(500).json({ error: 'artifact row missing object_name' });
      return;
    }
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    const par = await createReadPar(cfg, objectName, expiresAt);
    // OCI's PAR `fullPath` sometimes comes back as a complete URL
    // (https://<ns>.objectstorage.<region>.oci.customer-oci.com/p/...)
    // and sometimes as a path-only (`/p/...`). Handle both shapes.
    const downloadUrl = /^https?:\/\//i.test(par.fullPath)
      ? par.fullPath
      : `https://objectstorage.${cfg.ociRegion}.oraclecloud.com${par.fullPath}`;
    res.json({
      artifact: row,
      downloadUrl,
      expiresAt: par.expiresAt.toISOString(),
    });
  }),
);

/**
 * POST /api/corpus/search  — JSON body
 *
 * Body:
 *   query              (required) natural-language search query
 *   kind               (optional) filter by single artifact kind
 *   notebookId         (optional) filter by notebook linkage
 *   candidateLimit     (optional) chunks to scan before grouping (default 40, max 200)
 *   artifactLimit      (optional) artifacts to return (default 10, max 50)
 *   snippetsPerArtifact(optional) chunks per artifact (default 3, max 10)
 *   maxDistance        (optional) cosine distance ceiling (e.g. 0.7)
 *
 * Returns `{ query, hits: [{ artifact, bestDistance, snippets }], ... }`
 * sorted by best distance ascending (most-relevant first).
 */
corpusRouter.post(
  '/search',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = typeof body['query'] === 'string' ? body['query'].trim() : '';
    if (query.length === 0) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const result = await searchCorpus(cfg, {
      query,
      kind: typeof body['kind'] === 'string' ? body['kind'] : undefined,
      notebookId:
        typeof body['notebookId'] === 'string' ? body['notebookId'] : undefined,
      candidateLimit:
        typeof body['candidateLimit'] === 'number' ? body['candidateLimit'] : undefined,
      artifactLimit:
        typeof body['artifactLimit'] === 'number' ? body['artifactLimit'] : undefined,
      snippetsPerArtifact:
        typeof body['snippetsPerArtifact'] === 'number'
          ? body['snippetsPerArtifact']
          : undefined,
      maxDistance:
        typeof body['maxDistance'] === 'number' ? body['maxDistance'] : undefined,
    });
    res.json(result);
  }),
);

/**
 * POST /api/corpus/chat
 *
 * Retrieval-augmented chat over the corpus.
 *
 * Body:
 *   question           (required) string - the user's current message
 *   history            (optional) Array<{ role: 'user'|'assistant', content }>
 *   kind               (optional) artifact kind filter passed to retrieval
 *   notebookId         (optional) restrict retrieval to a single notebook
 *   maxSources         (optional) artifacts to retrieve (default 6, max 10)
 *   snippetsPerSource  (optional) chunks per artifact in the prompt
 *                                 (default 2, max 4)
 *   maxDistance        (optional) cosine ceiling for retrieval (default 0.75)
 *
 * Returns:
 *   { answer, citations: [{start,end,text,sourceIndices[]}],
 *     sources: [{index, artifact, snippets, bestDistance}],
 *     retrievalMs, chatMs, noSources, finishReason?, inputTokens?, outputTokens? }
 *
 * 503 if either the corpus is disabled OR the chat model is not configured
 * (set OCI_GENAI_CHAT_MODEL in .env to enable).
 */
corpusRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    if (!cfg.ociGenAiChatModel) {
      res.status(503).json({
        error:
          'corpus chat is disabled — set OCI_GENAI_CHAT_MODEL in .env to enable',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const question =
      typeof body['question'] === 'string' ? body['question'].trim() : '';
    if (question.length === 0) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    if (question.length > 4000) {
      res.status(400).json({ error: 'question too long (max 4000 chars)' });
      return;
    }

    // Validate + normalize history; cap at the last 10 turns to bound prompt
    // size. Anything older than that almost never improves the answer and
    // just inflates the input-token bill.
    const rawHistory = Array.isArray(body['history']) ? body['history'] : [];
    const history: ChatTurn[] = [];
    for (const t of rawHistory.slice(-10)) {
      if (typeof t !== 'object' || t === null) continue;
      const role = (t as { role?: unknown }).role;
      const content = (t as { content?: unknown }).content;
      if (
        (role === 'user' || role === 'assistant') &&
        typeof content === 'string' &&
        content.trim().length > 0
      ) {
        history.push({ role, content });
      }
    }

    const result = await chatCorpus(cfg, {
      question,
      history,
      kind: typeof body['kind'] === 'string' ? body['kind'] : undefined,
      notebookId:
        typeof body['notebookId'] === 'string' ? body['notebookId'] : undefined,
      maxSources:
        typeof body['maxSources'] === 'number' ? body['maxSources'] : undefined,
      snippetsPerSource:
        typeof body['snippetsPerSource'] === 'number'
          ? body['snippetsPerSource']
          : undefined,
      maxDistance:
        typeof body['maxDistance'] === 'number' ? body['maxDistance'] : undefined,
    });
    res.json(result);
  }),
);

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * PATCH /api/corpus/artifacts/:id
 *
 * Body (all optional): { title?: string, tags?: string[] }
 * Updates only the fields provided. 404 if the row doesn't exist.
 */
corpusRouter.patch(
  '/artifacts/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const id = req.params['id'];
    if (!id || !ULID_RE.test(id)) {
      res.status(400).json({ error: 'invalid artifact id' });
      return;
    }
    const body = (req.body ?? {}) as { title?: unknown; tags?: unknown };

    const updates: string[] = [];
    const binds: Record<string, unknown> = { id };
    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (t.length === 0 || t.length > 512) {
        res.status(400).json({ error: 'title must be 1..512 characters' });
        return;
      }
      updates.push('title = :title');
      binds['title'] = t;
    }
    if (Array.isArray(body.tags)) {
      const cleaned = body.tags
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x.length > 0 && x.length <= 32)
        .slice(0, 32);
      updates.push('tags = :tags');
      binds['tags'] = JSON.stringify(cleaned);
    }
    if (updates.length === 0) {
      res.status(400).json({ error: 'no updatable fields supplied' });
      return;
    }
    updates.push('updated_at = SYSTIMESTAMP');

    const rowsAffected = await withConnection(cfg, async (conn) => {
      const r = await conn.execute(
        `UPDATE artifacts SET ${updates.join(', ')} WHERE id = :id`,
        binds as oracledb.BindParameters,
        { autoCommit: true },
      );
      return r.rowsAffected ?? 0;
    });
    if (rowsAffected === 0) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    res.json({ ok: true, id });
  }),
);

/**
 * DELETE /api/corpus/artifacts/:id
 *
 * Deletes the DB row (chunks cascade) and the underlying Object Storage
 * blob. Returns { deleted: true, blobDeleted: bool } so callers can tell
 * whether the blob was already missing.
 */
corpusRouter.delete(
  '/artifacts/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const id = req.params['id'];
    if (!id || !ULID_RE.test(id)) {
      res.status(400).json({ error: 'invalid artifact id' });
      return;
    }

    const objectName = await withConnection(cfg, async (conn) => {
      // Capture the object name before we delete the row.
      const sel = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT object_name FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const found = sel.rows?.[0]?.OBJECT_NAME;
      if (!found) return null;
      // FK on artifact_chunks.artifact_id is ON DELETE CASCADE so chunks go too.
      await conn.execute(
        `DELETE FROM artifacts WHERE id = :id`,
        { id },
        { autoCommit: true },
      );
      return found;
    });
    if (!objectName) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    // Best-effort blob delete; never fail the request if OCI complains.
    let blobDeleted = false;
    try {
      const r = await deleteObject(cfg, objectName);
      blobDeleted = r.deleted;
    } catch (err) {
      console.error(
        '[corpus] blob delete failed; row already gone',
        objectName,
        err instanceof Error ? err.message : err,
      );
    }
    res.json({ deleted: true, id, blobDeleted });
  }),
);

/**
 * POST /api/corpus/artifacts/:id/share
 *
 * Body: { ttlHours?: number }  (default 24, max 168 = 7 days)
 *
 * Returns a fresh PAR-backed download URL with the requested TTL, suitable
 * for sharing externally. Note: PARs cannot be revoked from this app —
 * shorter TTLs are safer. (Use OCI console to delete a PAR if needed.)
 */
corpusRouter.post(
  '/artifacts/:id/share',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const id = req.params['id'];
    if (!id || !ULID_RE.test(id)) {
      res.status(400).json({ error: 'invalid artifact id' });
      return;
    }
    const body = (req.body ?? {}) as { ttlHours?: unknown };
    const requested =
      typeof body.ttlHours === 'number' && Number.isFinite(body.ttlHours)
        ? body.ttlHours
        : 24;
    const ttlHours = Math.min(Math.max(Math.floor(requested), 1), 168); // 1h..7d

    const objectName = await withConnection(cfg, async (conn) => {
      const r = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT object_name FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return r.rows?.[0]?.OBJECT_NAME ?? null;
    });
    if (!objectName) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const par = await createReadPar(
      cfg,
      objectName,
      expiresAt,
      `share-${id.slice(-8)}-${Date.now()}`,
    );
    const shareUrl = /^https?:\/\//i.test(par.fullPath)
      ? par.fullPath
      : `https://objectstorage.${cfg.ociRegion}.oraclecloud.com${par.fullPath}`;

    res.json({
      shareUrl,
      ttlHours,
      expiresAt: par.expiresAt.toISOString(),
    });
  }),
);

/**
 * POST /api/corpus/artifacts/:id/transcribe   (M7)
 *
 * Manually re-run transcription for an audio/video artifact. Used by the
 * "Retry" button in the Library UI when a previous job failed or when the
 * row was skipped. Safe to call on rows already `done` — will be a no-op
 * at the enqueue level (handled inside `retryTranscription`).
 *
 * Responds 200 immediately with `{ status: 'queued' }`; the poller picks
 * the row up on its next tick. Errors are surfaced via the artifact row's
 * `transcription_status = 'failed'` + `transcription_error`, not here.
 */
corpusRouter.post(
  '/artifacts/:id/transcribe',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    if (!cfg.speechEnabled) {
      res
        .status(503)
        .json({ error: 'transcription is disabled (set OCI_SPEECH_ENABLED=true)' });
      return;
    }
    const id = req.params['id'];
    if (!id || !ULID_RE.test(id)) {
      res.status(400).json({ error: 'invalid artifact id' });
      return;
    }
    // Verify the row exists + is audio/video up front, so we can give a
    // useful 4xx instead of a silent `skipped` update.
    const row = await withConnection(cfg, async (conn) => {
      const r = await conn.execute<{ KIND: string }>(
        `SELECT kind FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return r.rows?.[0];
    });
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    if (row.KIND !== 'audio' && row.KIND !== 'video') {
      res.status(400).json({
        error: `kind "${row.KIND}" is not transcribable (only audio/video)`,
      });
      return;
    }

    // Fire the enqueue but don't block the HTTP response — submit +
    // status update can take a second or two and the client just wants
    // to know we accepted the request.
    void (async () => {
      try {
        await retryTranscription(cfg, id);
      } catch (err) {
        console.warn(
          `[corpus] /transcribe retry failed for ${id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();
    res.status(202).json({ id, status: 'queued' });
  }),
);

/**
 * POST /api/corpus/chat/save
 *
 * Persist a NotebookLM chat conversation as a `kind='qa'` corpus artifact
 * so it can be searched + chatted-against later. Idempotent on
 * `sessionId`: re-saving the same conversation updates the existing
 * row (chunks deleted + re-embedded + object overwritten) instead of
 * creating duplicates.
 *
 * Request body (JSON):
 * {
 *   notebookId:    string  (required)  NotebookLM notebook ID
 *   notebookTitle: string  (required)  display name of the notebook
 *   sessionId:     string  (required)  client-minted UUID per conversation
 *   title:         string  (required)  user-edited artifact title
 *   turns: Array<{
 *     role:      'user' | 'assistant',
 *     content:   string,
 *     citations?: Array<{ index: number, excerpt: string, sourceId: string|null }>
 *   }>  (required, non-empty)
 * }
 *
 * Response 200:
 * { id: string, sessionId: string, chunkCount: number, created: boolean }
 *
 *   `created=true`  → first save for this sessionId (INSERT)
 *   `created=false` → updated an existing row (UPDATE)
 */
corpusRouter.post(
  '/chat/save',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const notebookId =
      typeof body['notebookId'] === 'string' ? body['notebookId'].trim() : '';
    const notebookTitle =
      typeof body['notebookTitle'] === 'string'
        ? body['notebookTitle'].trim()
        : '';
    const sessionId =
      typeof body['sessionId'] === 'string' ? body['sessionId'].trim() : '';
    const title =
      typeof body['title'] === 'string' ? body['title'].trim() : '';
    const turnsRaw = Array.isArray(body['turns']) ? body['turns'] : null;

    if (!notebookId) {
      res.status(400).json({ error: 'notebookId is required' });
      return;
    }
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    // Loose UUID-ish sanity check — keeps obvious garbage out without
    // pinning us to a specific generator.
    if (sessionId.length < 8 || sessionId.length > 64) {
      res.status(400).json({ error: 'sessionId must be 8–64 chars' });
      return;
    }
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!turnsRaw || turnsRaw.length === 0) {
      res.status(400).json({ error: 'turns must be a non-empty array' });
      return;
    }

    // Coerce + validate each turn. We're strict about shape here because
    // bad data flows straight into embed + DB and is annoying to clean up.
    const turns: SavedChatTurn[] = [];
    for (let i = 0; i < turnsRaw.length; i++) {
      const t = turnsRaw[i] as Record<string, unknown> | null;
      if (!t || typeof t !== 'object') {
        res.status(400).json({ error: `turns[${i}] must be an object` });
        return;
      }
      const role = t['role'];
      const content = t['content'];
      if (role !== 'user' && role !== 'assistant') {
        res
          .status(400)
          .json({ error: `turns[${i}].role must be "user" or "assistant"` });
        return;
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        res
          .status(400)
          .json({ error: `turns[${i}].content must be a non-empty string` });
        return;
      }
      const citationsRaw = Array.isArray(t['citations']) ? t['citations'] : [];
      const citations = citationsRaw
        .map((c) => {
          const cc = c as Record<string, unknown> | null;
          if (!cc || typeof cc !== 'object') return null;
          const idx = typeof cc['index'] === 'number' ? cc['index'] : null;
          const excerpt = typeof cc['excerpt'] === 'string' ? cc['excerpt'] : '';
          const sid =
            typeof cc['sourceId'] === 'string'
              ? cc['sourceId']
              : cc['sourceId'] === null
              ? null
              : null;
          if (idx === null) return null;
          return { index: idx, excerpt, sourceId: sid };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
      turns.push({ role, content, citations });
    }

    // At least one user turn — guards against the empty-state save.
    if (!turns.some((t) => t.role === 'user')) {
      res.status(400).json({ error: 'at least one user turn is required' });
      return;
    }

    try {
      const result = await saveChatArtifact(cfg, {
        notebookId,
        notebookTitle: notebookTitle || 'NotebookLM',
        sessionId,
        title,
        turns,
      });
      res.json(result);
    } catch (err) {
      console.warn(
        '[corpus] /chat/save failed:',
        err instanceof Error ? err.message : err,
      );
      const msg = err instanceof Error ? err.message : 'save failed';
      res.status(500).json({ error: msg });
    }
  }),
);
