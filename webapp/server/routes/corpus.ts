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
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import oracledb from 'oracledb';
import mammoth from 'mammoth';
import { asyncHandler } from '../lib/handler.js';
import { getJob } from '../lib/job-store.js';
import {
  corpusHealth,
  getCorpusConfig,
  withConnection,
  createReadPar,
  deleteObject,
  getObjectBuffer,
  searchCorpus,
  chatCorpus,
  chatCorpusStream,
  getChatPersist,
  setChatPersist,
  getChatThread,
  saveChatThread,
  deleteChatThread,
  type ChatTurn,
  type ChatOptions,
  retryTranscription,
} from '../corpus/index.js';
import {
  ingestArtifact,
  saveChatArtifact,
  updateArtifactText,
  type ArtifactKind,
  type ArtifactOrigin,
  type SavedChatTurn,
} from '../corpus/ingest.js';
import {
  listCollections,
  createCollection,
  getCollection,
  updateCollection,
  deleteCollection,
} from '../corpus/collections.js';
import {
  getIndexStatus,
  listUnchunked,
  listTargets,
  reembedOne,
  isMediaKind,
  type Row,
} from '../corpus/reembed-core.js';
import { openSseStream } from '../lib/sse.js';

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
  'mind',
  'upload',
  'note',
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
 * GET /api/corpus/models
 * Fetches available models from Gemini and Mimo if configured.
 */
corpusRouter.get(
  '/models',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }

    const result: { gemini: string[]; mimo: string[] } = { gemini: [], mimo: [] };

    if (cfg.geminiApiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${cfg.geminiApiKey}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const json = (await resp.json()) as any;
          if (json.models && Array.isArray(json.models)) {
            result.gemini = json.models
              .map((m: any) => (m.name || '').replace('models/', ''))
              .filter((m: string) => m.startsWith('gemini'));
          }
        }
      } catch (e) {
        console.error('Failed to fetch Gemini models:', e);
      }
    }

    if (cfg.mimoApiKey && cfg.mimoBaseUrl) {
      try {
        const baseUrl = cfg.mimoBaseUrl.replace(/\/$/, '');
        const url = `${baseUrl}/models`;
        const resp = await fetch(url, {
          headers: { 'api-key': cfg.mimoApiKey }
        });
        if (resp.ok) {
          const json = (await resp.json()) as any;
          if (json.data && Array.isArray(json.data)) {
            result.mimo = json.data.map((m: any) => m.id);
          }
        }
      } catch (e) {
        console.error('Failed to fetch Mimo models:', e);
      }
    }

    // Fallback if Mimo didn't return any models via API
    if (result.mimo.length === 0) {
      result.mimo = [
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2.5-tts-voiceclone',
        'mimo-v2.5-tts-voicedesign',
        'mimo-v2.5-tts'
      ];
    }

    res.json(result);
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
      collectionId: body['collectionId'] || undefined,
      tags,
      metadata,
    });
    res.status(201).json(result);
  }),
);

// ───────────────────────────────────────────────────────────── collections ──

/** GET /api/corpus/collections — list with item counts + per-kind breakdown. */
corpusRouter.get(
  '/collections',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    res.json({ collections: await listCollections(cfg) });
  }),
);

/** POST /api/corpus/collections — create { name, description?, tags? }. */
corpusRouter.post(
  '/collections',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown; tags?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 256) {
      res.status(400).json({ error: 'name is required (1..256 chars)' });
      return;
    }
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string')
      : undefined;
    try {
      const created = await createCollection(cfg, {
        name,
        description: typeof body.description === 'string' ? body.description : undefined,
        tags,
      });
      res.status(201).json(created);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORA-00001/.test(msg)) {
        res.status(409).json({ error: `a collection named "${name}" already exists` });
        return;
      }
      throw err;
    }
  }),
);

/** GET /api/corpus/collections/:id — detail + files. */
corpusRouter.get(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const detail = await getCollection(cfg, req.params['id']);
    if (!detail) {
      res.status(404).json({ error: 'collection not found' });
      return;
    }
    res.json(detail);
  }),
);

/** PATCH /api/corpus/collections/:id — { name?, description?, tags? }. */
corpusRouter.patch(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as { name?: unknown; description?: unknown; tags?: unknown };
    try {
      const ok = await updateCollection(cfg, req.params['id'], {
        name: typeof body.name === 'string' ? body.name : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t): t is string => typeof t === 'string')
          : undefined,
      });
      if (!ok) {
        res.status(404).json({ error: 'collection not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ORA-00001/.test(msg)) {
        res.status(409).json({ error: 'a collection with that name already exists' });
        return;
      }
      throw err;
    }
  }),
);

/** DELETE /api/corpus/collections/:id — artifacts demote to free-form. */
corpusRouter.delete(
  '/collections/:id',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const ok = await deleteCollection(cfg, req.params['id']);
    if (!ok) {
      res.status(404).json({ error: 'collection not found' });
      return;
    }
    res.json({ ok: true });
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
    if (q['category']) {
      whereClauses.push('category = :category');
      filterBinds['category'] = q['category'];
    }
    if (q['collectionId']) {
      whereClauses.push('collection_id = :collectionId');
      filterBinds['collectionId'] = q['collectionId'];
    }
    if (q['tag']) {
      // Tag-membership filter, index-backed by ix_artifacts_tags_mv. Tags are
      // stored lowercased (see PATCH /artifacts/:id), so normalize the query
      // term to match.
      whereClauses.push(`JSON_EXISTS(tags, '$[*]?(@ == $t)' PASSING :tag AS "t")`);
      filterBinds['tag'] = q['tag'].toLowerCase();
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const listBinds = { ...filterBinds, lim: limit, off: offset };

    const { items, total } = await withConnection(cfg, async (conn) => {
      const listSql = `
        SELECT id, kind, origin, category, title, notebook_id, artifact_id, collection_id,
               (SELECT name FROM collections cc WHERE cc.id = a.collection_id) AS collection_name,
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
 * GET /api/corpus/tags
 *
 * Distinct artifact tags with their usage counts, most-used first. Powers the
 * browse facet / tag filter bar. Flattens the JSON `tags` array per row via
 * JSON_TABLE and groups.
 *
 * Returns `{ tags: [{ tag, count }] }`.
 */
corpusRouter.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const rows = await withConnection(cfg, async (conn) => {
      const result = await conn.execute<{ TAG: string; CNT: number }>(
        `SELECT jt.tag AS tag, COUNT(*) AS cnt
           FROM artifacts a,
                JSON_TABLE(a.tags, '$[*]' COLUMNS (tag VARCHAR2(256) PATH '$')) jt
          WHERE jt.tag IS NOT NULL
          GROUP BY jt.tag
          ORDER BY cnt DESC, jt.tag`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows ?? [];
    });
    res.json({ tags: rows.map((r) => ({ tag: r.TAG, count: Number(r.CNT) })) });
  }),
);

// ─────────────────────────────────────────── search-index backfill (M8) ──

/** Shape one un-chunked artifact row for the client list. */
function unchunkedItem(r: Row) {
  return {
    id: r.ID,
    title: r.TITLE,
    kind: r.KIND,
    mimeType: r.MIME_TYPE,
    createdAt: r.CREATED_AT ? new Date(r.CREATED_AT).toISOString() : null,
  };
}

/**
 * GET /api/corpus/index-status
 *
 * Counts for the Diagnose → Search index panel:
 *   { total, chunked, fixable, media, provider }
 * `fixable` = 0-chunk docs backfill can index; `media` = audio/video awaiting
 * transcription (0-chunk by design).
 */
corpusRouter.get(
  '/index-status',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const status = await getIndexStatus(cfg);
    res.json({ ...status, provider: cfg.embeddingProvider });
  }),
);

/**
 * GET /api/corpus/unchunked
 *
 * The un-chunked artifacts split into the two groups the UI shows:
 *   { fixable: [...], media: [...] }
 */
corpusRouter.get(
  '/unchunked',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const { fixable, media } = await listUnchunked(cfg);
    res.json({
      fixable: fixable.map(unchunkedItem),
      media: media.map(unchunkedItem),
    });
  }),
);

/**
 * POST /api/corpus/reembed  — multipart/form-data, SSE response
 *
 * Backfills chunks for un-chunked artifacts, streaming per-document progress.
 * Field `ids` (optional) is a JSON array of artifact ids to target; when
 * omitted, every *fixable* (non-media) 0-chunk artifact is processed. Audio/
 * video is always excluded — it has no text until transcription runs.
 *
 * Emits SSE `progress` events ({ status, message, index, total, done, … }) per
 * document and a final `result` event ({ tally, processed }).
 */
corpusRouter.post(
  '/reembed',
  upload.none(),
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }

    // Resolve the target rows: explicit ids (media filtered out) or all fixable.
    const body = (req.body ?? {}) as { ids?: unknown };
    let ids: string[] = [];
    if (typeof body.ids === 'string' && body.ids.trim()) {
      try {
        const parsed = JSON.parse(body.ids);
        if (Array.isArray(parsed)) ids = parsed.map((x) => String(x));
      } catch {
        res.status(400).json({ error: 'ids must be a JSON array string' });
        return;
      }
    }
    const targets: Row[] = ids.length
      ? (await listTargets(cfg, ids)).filter((r) => !isMediaKind(r.KIND))
      : (await listUnchunked(cfg)).fixable;

    const stream = openSseStream(res);
    const tally: Record<string, number> = {};
    let processed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (stream.closed) break; // client disconnected
        const row = targets[i]!;
        const o = await reembedOne(cfg, row, true);
        tally[o.status] = (tally[o.status] ?? 0) + 1;
        processed++;
        stream.progress({
          status: o.status,
          message:
            o.status === 'indexed'
              ? `${row.TITLE} — ${o.chunks} chunks${o.viaOcr ? ' (via OCR)' : ''}`
              : o.status === 'no-text'
                ? `${row.TITLE} — no extractable text`
                : `${row.TITLE} — ${o.error ?? o.status}`,
          index: i + 1,
          total: targets.length,
          artifactId: row.ID,
          chunks: o.chunks ?? 0,
          viaOcr: !!o.viaOcr,
        } as unknown as Parameters<typeof stream.progress>[0]);
        // Gentle throttle between live OCR/embed calls (free-tier friendliness),
        // matching the CLI. Skip the wait after the last item.
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 3000));
      }
      stream.result({ tally, processed, total: targets.length });
    } catch (err) {
      stream.error(err instanceof Error ? err.message : String(err));
    }
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

// ── MIME inference helper for files where the stored mime_type is null ──
function inferMimeType(objectName: string): string | null {
  const ext = objectName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
  };
  return ext ? (map[ext] ?? null) : null;
}

// ── Table viewer helpers (JSON + CSV) ────────────────────────────────────────

function _esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtmlTable(rows: string[][]): string {
  const [header, ...body] = rows;
  if (!header || header.length === 0) return '';
  const thead = `<thead><tr>${header.map((h) => `<th>${_esc(h)}</th>`).join('')}</tr></thead>`;
  const tbody =
    body.length > 0
      ? `<tbody>${body
          .map((row) => `<tr>${row.map((cell) => `<td>${_esc(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody>`
      : '';
  return `<table>${thead}${tbody}</table>`;
}

/**
 * Parse a CSV string (RFC-4180 quoting) into an HTML table.
 * Returns null when the CSV has fewer than 2 rows or is unparseable.
 */
function csvToHtml(csv: string): string | null {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cells.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    return cells;
  };

  const rows = lines.map(parseRow);
  return rows.length >= 2 ? renderHtmlTable(rows) : null;
}

/** Recursively find the first string value in a nested array structure. */
function extractFirstString(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (!Array.isArray(val)) return null;
  for (const item of val) {
    const result = extractFirstString(item);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Parse the NotebookLM data_table JSON format.
 *
 * Structure:
 *   parsed[0][0][0][0] = tableNode  →  [startPos, endPos, null, null, [type, ?, rowsArray]]
 *   tableNode[4][2]    = rowsArray  →  array of rows, each [start, end, cellsArray]
 *   each cell          = deeply nested array whose leaf string is the cell text
 *   parsed[0][0][0][1] = footnoteNode (optional)
 */
function parseNotebookLMDataTable(parsed: unknown): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections: unknown = (parsed as any)[0]?.[0]?.[0];
    if (!Array.isArray(sections) || sections.length === 0) return null;

    const tableNode: unknown = sections[0];
    if (!Array.isArray(tableNode)) return null;

    const tableStruct: unknown = tableNode[4];
    if (!Array.isArray(tableStruct) || tableStruct.length < 3) return null;

    const rowsArray: unknown = tableStruct[2];
    if (!Array.isArray(rowsArray) || rowsArray.length === 0) return null;

    const rows: string[][] = [];
    for (const row of rowsArray) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const cellsArray: unknown = row[2];
      if (!Array.isArray(cellsArray)) continue;
      const cells = cellsArray.map((cell: unknown) => extractFirstString(cell) ?? '');
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return null;

    let html = renderHtmlTable(rows);

    // Append footnotes if present (sibling of tableNode)
    if (sections.length > 1) {
      const footnoteText = extractFirstString(sections[1]);
      if (footnoteText) {
        html += `<p class="footnote" style="margin-top:0.5rem;font-size:0.75rem;color:#64748b">${_esc(footnoteText)}</p>`;
      }
    }

    return html;
  } catch {
    return null;
  }
}

interface MindNode {
  name: string;
  children: MindNode[];
}

/**
 * Normalise a NotebookLM mind-map node tree ({ name, children|nodes: [...] })
 * into a clean { name, children } shape. Returns null when the value isn't a
 * mind-map tree, so the caller can fall back to table/text rendering. The
 * client renders this tree as an interactive, pan/zoomable diagram.
 */
function mindMapToTree(parsed: unknown): MindNode | null {
  const isNode = (v: unknown): v is { name?: unknown; children?: unknown; nodes?: unknown } =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  const normalize = (node: unknown): MindNode | null => {
    if (!isNode(node)) return null;
    const name = typeof node.name === 'string' ? node.name : '';
    const kidsRaw = Array.isArray(node.children)
      ? node.children
      : Array.isArray(node.nodes)
        ? node.nodes
        : [];
    const children = kidsRaw.map(normalize).filter((n): n is MindNode => n !== null);
    if (!name && children.length === 0) return null;
    return { name, children };
  };

  if (!isNode(parsed)) return null;
  const hasChildren = Array.isArray(parsed.children) || Array.isArray(parsed.nodes);
  // Require a name plus a children/nodes array — the mind-map shape.
  if (typeof parsed.name !== 'string' || !hasChildren) return null;
  return normalize(parsed);
}

/**
 * Try to render a parsed JSON value as an HTML table using multiple strategies:
 *
 * 1. NotebookLM data_table format: deeply nested row/cell structure.
 * 2. Plain arrays-of-arrays at the top level.
 * 3. Array-of-objects [{col: val, …}, …] — keys become the header row.
 *
 * Returns an HTML <table> string or null when no table structure is detected.
 */
function anyJsonToHtml(parsed: unknown): string | null {
  const toStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // Strategy 1: NotebookLM data_table specific format.
  const nbResult = parseNotebookLMDataTable(parsed);
  if (nbResult) return nbResult;

  if (Array.isArray(parsed)) {
    // Strategy 2: plain arrays-of-arrays — collect leaf rows recursively.
    function findRows(data: unknown): string[][] {
      const rows: string[][] = [];
      function walk(val: unknown): void {
        if (!Array.isArray(val)) return;
        if (val.length >= 1 && val.every((c) => !Array.isArray(c))) {
          rows.push(val.map(toStr));
          return;
        }
        for (const item of val) walk(item);
      }
      walk(data);
      return rows;
    }
    const rows = findRows(parsed);
    if (rows.length > 1) return renderHtmlTable(rows);

    // Strategy 3: array-of-objects [{col: val, …}, …]
    if (
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      parsed[0] !== null &&
      !Array.isArray(parsed[0])
    ) {
      const keys = [
        ...new Set(
          parsed.flatMap((item) =>
            typeof item === 'object' && item !== null && !Array.isArray(item)
              ? Object.keys(item as Record<string, unknown>)
              : [],
          ),
        ),
      ];
      if (keys.length > 0) {
        const dataRows = parsed.map((item) =>
          keys.map((k) =>
            toStr(
              typeof item === 'object' && item !== null
                ? (item as Record<string, unknown>)[k]
                : undefined,
            ),
          ),
        );
        return renderHtmlTable([keys, ...dataRows]);
      }
    }
  }

  return null;
}

/**
 * GET /api/corpus/artifacts/:id/view
 *
 * Returns enough information for the client to render the artifact inline:
 *
 *   type="pdf"         → downloadUrl is a PAR; client embeds in <iframe>
 *   type="office"      → officeViewerUrl is an MS Office Online embed URL
 *   type="html"        → content is rendered HTML (DOCX via mammoth, CSV/JSON tables)
 *   type="markdown"    → content is raw Markdown; client renders it
 *   type="text"        → content is raw UTF-8 text
 *   type="unsupported" → preview not available; downloadUrl always present as fallback
 */
corpusRouter.get(
  '/artifacts/:id/view',
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

    const row = await withConnection(cfg, async (conn) => {
      const result = await conn.execute<Record<string, unknown>>(
        `SELECT object_name, mime_type FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return result.rows?.[0];
    });
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }

    const r = row as Record<string, unknown>;
    const objectName = r['OBJECT_NAME'] as string;
    // Normalise: strip charset / boundary params (e.g. "text/markdown; charset=utf-8" → "text/markdown").
    const rawMimeFull = (r['MIME_TYPE'] as string | null) ?? null;
    const rawMime = rawMimeFull ? rawMimeFull.split(';')[0]!.trim() : null;
    // Treat application/octet-stream as "unknown" — browsers send this for file
    // types they don't recognise (common for .md on Windows). Prefer the extension
    // inferred from the object name, which always carries the original filename.
    const mimeType =
      !rawMime || rawMime === 'application/octet-stream'
        ? (inferMimeType(objectName) ?? rawMime ?? null)
        : rawMime;

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const par = await createReadPar(cfg, objectName, expiresAt);
    const downloadUrl = /^https?:\/\//i.test(par.fullPath)
      ? par.fullPath
      : `https://objectstorage.${cfg.ociRegion}.oraclecloud.com${par.fullPath}`;
    const base = {
      downloadUrl,
      expiresAt: par.expiresAt.toISOString(),
      mimeType: mimeType ?? undefined,
    };

    if (mimeType === 'application/pdf' || mimeType === 'text/html') {
      res.json({ type: 'pdf', ...base });
      return;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(downloadUrl)}`;
      res.json({ type: 'office', officeViewerUrl, ...base });
      return;
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const buffer = await getObjectBuffer(cfg, objectName);
      const result = await mammoth.convertToHtml({ buffer });
      res.json({ type: 'html', content: result.value, ...base });
      return;
    }

    if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
      // Return raw Markdown; the client renders it so it can run Mermaid /
      // highlighting / math passes that must execute in the browser.
      const buffer = await getObjectBuffer(cfg, objectName);
      const text = buffer.toString('utf8');
      res.json({ type: 'markdown', content: text, ...base });
      return;
    }

    if (mimeType === 'text/plain') {
      const buffer = await getObjectBuffer(cfg, objectName);
      const text = buffer.slice(0, 1024 * 1024).toString('utf8');
      res.json({ type: 'text', content: text, ...base });
      return;
    }

    if (mimeType === 'text/csv') {
      const buffer = await getObjectBuffer(cfg, objectName);
      const text = buffer.slice(0, 1024 * 1024).toString('utf8');
      const tableHtml = csvToHtml(text);
      if (tableHtml) {
        res.json({ type: 'html', content: tableHtml, ...base });
      } else {
        res.json({ type: 'text', content: text, ...base });
      }
      return;
    }

    if (mimeType === 'application/json') {
      const buffer = await getObjectBuffer(cfg, objectName);
      const text = buffer.slice(0, 1024 * 1024).toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = null; }

      if (parsed !== null) {
        // Mind maps ({name, children}) render as an interactive tree diagram;
        // other JSON falls back to the table strategies, then raw text.
        const tree = mindMapToTree(parsed);
        if (tree) {
          res.json({ type: 'mindmap', tree, ...base });
          return;
        }
        const tableHtml = anyJsonToHtml(parsed);
        if (tableHtml) {
          res.json({ type: 'html', content: tableHtml, ...base });
        } else {
          res.json({ type: 'text', content: JSON.stringify(parsed, null, 2), ...base });
        }
      } else {
        res.json({ type: 'text', content: text, ...base });
      }
      return;
    }

    if (mimeType && mimeType.startsWith('image/')) {
      res.json({ type: 'image', ...base });
      return;
    }

    res.json({ type: 'unsupported', ...base });
  }),
);

/**
 * GET /api/corpus/artifacts/:id/raw — raw UTF-8 text of a text-like artifact
 * (markdown/text). Used by the editor to load existing content. Returns
 * { content, mimeType }.
 */
corpusRouter.get(
  '/artifacts/:id/raw',
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
    const row = await withConnection(cfg, async (conn) => {
      const r = await conn.execute<{ OBJECT_NAME: string; MIME_TYPE: string | null }>(
        `SELECT object_name, mime_type FROM artifacts WHERE id = :id`,
        { id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return r.rows?.[0];
    });
    if (!row) {
      res.status(404).json({ error: 'artifact not found' });
      return;
    }
    const buffer = await getObjectBuffer(cfg, row.OBJECT_NAME);
    res.json({ content: buffer.toString('utf8'), mimeType: row.MIME_TYPE ?? null });
  }),
);

/**
 * PUT /api/corpus/artifacts/:id/content — replace a text artifact's content.
 * Body: { markdown: string, title?: string }. Re-embeds + overwrites the blob.
 */
corpusRouter.put(
  '/artifacts/:id/content',
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
    const body = (req.body ?? {}) as { markdown?: unknown; title?: unknown };
    if (typeof body.markdown !== 'string') {
      res.status(400).json({ error: 'markdown is required' });
      return;
    }
    const result = await updateArtifactText(cfg, id, {
      markdown: body.markdown,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    res.json(result);
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
      kinds: Array.isArray(body['kinds'])
        ? body['kinds'].filter((k): k is string => typeof k === 'string')
        : undefined,
      notebookId:
        typeof body['notebookId'] === 'string' ? body['notebookId'] : undefined,
      collectionId:
        typeof body['collectionId'] === 'string' ? body['collectionId'] : undefined,
      category: typeof body['category'] === 'string' ? body['category'] : undefined,
      artifactId:
        typeof body['artifactId'] === 'string' ? body['artifactId'] : undefined,
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
 *   collectionId       (optional) restrict retrieval to a single collection
 *   category           (optional) notebooklm | collection | freeform
 *   artifactId         (optional) restrict retrieval to a single document
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
/**
 * Validate + normalise a corpus-chat request body into ChatOptions. Returns an
 * `{ error }` instead of throwing so both the JSON and SSE routes can surface a
 * 400 in their own way. History is capped at the last 10 turns to bound prompt
 * size — older turns rarely help the answer and just inflate the token bill.
 */
function parseChatRequest(
  body: Record<string, unknown>,
): { error: string } | { options: ChatOptions } {
  const question = typeof body['question'] === 'string' ? body['question'].trim() : '';
  if (question.length === 0) return { error: 'question is required' };
  if (question.length > 4000) return { error: 'question too long (max 4000 chars)' };

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

  return {
    options: {
      question,
      history,
      kind: typeof body['kind'] === 'string' ? body['kind'] : undefined,
      kinds: Array.isArray(body['kinds'])
        ? body['kinds'].filter((k): k is string => typeof k === 'string')
        : undefined,
      notebookId: typeof body['notebookId'] === 'string' ? body['notebookId'] : undefined,
      collectionId:
        typeof body['collectionId'] === 'string' ? body['collectionId'] : undefined,
      category: typeof body['category'] === 'string' ? body['category'] : undefined,
      artifactId: typeof body['artifactId'] === 'string' ? body['artifactId'] : undefined,
      maxSources: typeof body['maxSources'] === 'number' ? body['maxSources'] : undefined,
      snippetsPerSource:
        typeof body['snippetsPerSource'] === 'number'
          ? body['snippetsPerSource']
          : undefined,
      maxDistance: typeof body['maxDistance'] === 'number' ? body['maxDistance'] : undefined,
      chatProvider:
        typeof body['chatProvider'] === 'string' ? body['chatProvider'] : undefined,
      chatModel: typeof body['chatModel'] === 'string' ? body['chatModel'] : undefined,
    },
  };
}

corpusRouter.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    if (cfg.chatProvider === 'disabled') {
      res.status(503).json({
        error:
          'corpus chat is disabled — set CHAT_PROVIDER or GEMINI_API_KEY in .env to enable',
      });
      return;
    }

    const parsed = parseChatRequest((req.body ?? {}) as Record<string, unknown>);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const result = await chatCorpus(cfg, parsed.options);
    res.json(result);
  }),
);

/**
 * POST /api/corpus/chat/stream — same contract as /chat but streamed over SSE.
 * Emits `delta` events ({ text }) as the answer is generated, then a final
 * `result` event carrying the full ChatResult (sources, citations, timings).
 */
corpusRouter.post(
  '/chat/stream',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    if (cfg.chatProvider === 'disabled') {
      res.status(503).json({
        error:
          'corpus chat is disabled — set CHAT_PROVIDER or GEMINI_API_KEY in .env to enable',
      });
      return;
    }

    const parsed = parseChatRequest((req.body ?? {}) as Record<string, unknown>);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const sse = openSseStream(res);
    try {
      const result = await chatCorpusStream(cfg, parsed.options, (text) => {
        if (text) sse.event('delta', { text });
      });
      sse.result(result);
    } catch (err) {
      sse.error(err instanceof Error ? err.message : String(err));
    }
  }),
);

// ── Chat history persistence (the "save chats to the library" switch) ────────
// GET  /chat/prefs           → { persist }              read the global switch
// PUT  /chat/prefs           { persist }                set the global switch
// GET  /chat/thread?key=…    → { messages }             load a saved thread
// PUT  /chat/thread          { key, messages }          upsert a thread
// DELETE /chat/thread?key=…                             delete a thread
// All 503 when the corpus subsystem is disabled (no DB to read/write).

/** Max serialised thread we'll persist — guards the DB against runaway input. */
const MAX_THREAD_BYTES = 2 * 1024 * 1024;

corpusRouter.get(
  '/chat/prefs',
  asyncHandler(async (_req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    res.json({ persist: await getChatPersist(cfg) });
  }),
);

corpusRouter.put(
  '/chat/prefs',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['persist'] !== 'boolean') {
      res.status(400).json({ error: 'persist (boolean) is required' });
      return;
    }
    await setChatPersist(cfg, body['persist']);
    res.json({ persist: body['persist'] });
  }),
);

function readScopeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length === 0 || key.length > 256) return null;
  return key;
}

corpusRouter.get(
  '/chat/thread',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const key = readScopeKey(req.query['key']);
    if (!key) {
      res.status(400).json({ error: 'key (1..256 chars) is required' });
      return;
    }
    const messages = (await getChatThread(cfg, key)) ?? [];
    res.json({ messages });
  }),
);

corpusRouter.put(
  '/chat/thread',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = readScopeKey(body['key']);
    if (!key) {
      res.status(400).json({ error: 'key (1..256 chars) is required' });
      return;
    }
    if (!Array.isArray(body['messages'])) {
      res.status(400).json({ error: 'messages (array) is required' });
      return;
    }
    if (JSON.stringify(body['messages']).length > MAX_THREAD_BYTES) {
      res.status(413).json({ error: 'thread too large' });
      return;
    }
    await saveChatThread(cfg, key, body['messages']);
    res.json({ ok: true });
  }),
);

corpusRouter.delete(
  '/chat/thread',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }
    const key = readScopeKey(req.query['key']);
    if (!key) {
      res.status(400).json({ error: 'key (1..256 chars) is required' });
      return;
    }
    await deleteChatThread(cfg, key);
    res.json({ ok: true });
  }),
);

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * PATCH /api/corpus/artifacts/:id
 *
 * Body (all optional): { title?, tags?, kind?, description? }
 *   title       1..512 chars
 *   tags        string[] (lowercased, deduped server-side)
 *   kind        one of ALLOWED_KINDS — re-types the artifact (changes how it's
 *               classified + which Free Forms section it appears in)
 *   description free text stored in metadata.description ('' clears it)
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
    const body = (req.body ?? {}) as {
      title?: unknown;
      tags?: unknown;
      kind?: unknown;
      description?: unknown;
    };

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
    if (typeof body.kind === 'string') {
      const k = body.kind.trim() as ArtifactKind;
      if (!ALLOWED_KINDS.includes(k)) {
        res.status(400).json({ error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` });
        return;
      }
      updates.push('kind = :kind');
      binds['kind'] = k;
    }
    // Description lives in the metadata JSON column, so it needs a
    // read-modify-write of the existing metadata rather than a plain SET.
    const setDescription = typeof body.description === 'string';

    if (updates.length === 0 && !setDescription) {
      res.status(400).json({ error: 'no updatable fields supplied' });
      return;
    }

    const rowsAffected = await withConnection(cfg, async (conn) => {
      if (setDescription) {
        const sel = await conn.execute<{ METADATA: unknown }>(
          `SELECT metadata FROM artifacts WHERE id = :id`,
          { id },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        const existing = sel.rows?.[0];
        if (!existing) return 0; // row missing → 404 below
        let meta: Record<string, unknown> = {};
        const raw = existing.METADATA;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          meta = raw as Record<string, unknown>;
        } else if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              meta = parsed as Record<string, unknown>;
            }
          } catch {
            /* keep meta = {} */
          }
        }
        const desc = (body.description as string).trim().slice(0, 2000);
        if (desc) meta['description'] = desc;
        else delete meta['description'];
        updates.push('metadata = :meta');
        binds['meta'] = JSON.stringify(meta);
      }
      updates.push('updated_at = SYSTIMESTAMP');
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

/**
 * POST /api/corpus/save-from-job
 *
 * Save a generated artifact directly from a job temp directory into the
 * corpus. Used by the "Save to library" button in the Generate section.
 *
 * Body (JSON):
 *   jobId      string  (required)  job identifier from the generate response
 *   filename   string  (required)  file name within the job directory
 *   kind       string  (required)  generate kind (audio|report|quiz|flashcards|
 *                                  infographic|slides|data-table)
 *   title      string  (required)  display title for the artifact
 *   notebookId string  (optional)  link to originating NotebookLM notebook
 *
 * Returns the same shape as POST /api/corpus/ingest (201).
 */
corpusRouter.post(
  '/save-from-job',
  asyncHandler(async (req, res) => {
    const cfg = await getCorpusConfig();
    if (!cfg) {
      res.status(503).json({ error: 'corpus subsystem is disabled' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const jobId = typeof body['jobId'] === 'string' ? body['jobId'].trim() : '';
    const filename = typeof body['filename'] === 'string' ? body['filename'].trim() : '';
    const kindRaw = typeof body['kind'] === 'string' ? body['kind'].trim() : '';
    const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
    const notebookId =
      typeof body['notebookId'] === 'string' && body['notebookId'].trim().length > 0
        ? body['notebookId'].trim()
        : undefined;
    // Standalone generations (no notebook) save as free-form uploads; an
    // optional collectionId files them under a collection.
    const origin: ArtifactOrigin =
      body['origin'] === 'upload' ? 'upload' : notebookId ? 'notebooklm' : 'upload';
    const collectionId =
      typeof body['collectionId'] === 'string' && body['collectionId'].trim().length > 0
        ? body['collectionId'].trim()
        : undefined;

    if (!jobId) { res.status(400).json({ error: 'jobId is required' }); return; }
    if (!filename) { res.status(400).json({ error: 'filename is required' }); return; }
    if (!title || title.length === 0) { res.status(400).json({ error: 'title is required' }); return; }

    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'job not found or expired' });
      return;
    }

    // Prevent path traversal.
    const safeName = basename(filename);
    const fullPath = resolve(join(job.dir, safeName));
    if (!fullPath.startsWith(resolve(job.dir))) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }

    // Map generate kind (kebab-case) → corpus artifact kind (snake_case).
    const KIND_MAP: Record<string, ArtifactKind> = {
      audio: 'audio',
      report: 'report',
      video: 'video',
      quiz: 'quiz',
      flashcards: 'flashcards',
      infographic: 'infographic',
      slides: 'slides',
      'data-table': 'data_table',
      mind: 'mind',
    };
    const kind: ArtifactKind = KIND_MAP[kindRaw] ?? 'upload';

    // Determine MIME from extension so the ingest pipeline routes to the
    // correct extractor and the artifact viewer picks the right renderer.
    const ext = safeName.split('.').pop()?.toLowerCase() ?? '';
    const MIME_BY_EXT: Record<string, string> = {
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      md: 'text/markdown; charset=utf-8',
      html: 'text/html',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf',
      csv: 'text/csv',
      json: 'application/json',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
    };
    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    let buffer: Buffer;
    try {
      buffer = await readFile(fullPath);
    } catch {
      res.status(404).json({ error: 'file not found in job directory' });
      return;
    }

    const result = await ingestArtifact({
      buffer,
      title,
      kind,
      origin,
      mimeType,
      filename: safeName,
      notebookId,
      collectionId,
    });
    res.status(201).json(result);
  }),
);
