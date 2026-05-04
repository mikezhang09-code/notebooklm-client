/**
 * Corpus REST routes.
 *
 * M1: /health
 * M2: /ingest (multipart upload) + /artifacts (list)
 * M3: /search (semantic), /artifacts/:id (detail + PAR download link)
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../lib/handler.js';
import {
  corpusHealth,
  getCorpusConfig,
  withConnection,
  createReadPar,
} from '../corpus/index.js';
import {
  ingestArtifact,
  type ArtifactKind,
  type ArtifactOrigin,
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
    const binds: Record<string, string | number> = { lim: limit, off: offset };
    if (q['kind']) {
      whereClauses.push('kind = :kind');
      binds['kind'] = q['kind'];
    }
    if (q['origin']) {
      whereClauses.push('origin = :origin');
      binds['origin'] = q['origin'];
    }
    if (q['notebookId']) {
      whereClauses.push('notebook_id = :nb');
      binds['nb'] = q['notebookId'];
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const { items, total } = await withConnection(cfg, async (conn) => {
      const listSql = `
        SELECT id, kind, origin, title, notebook_id, artifact_id,
               bucket, object_name, mime_type, size_bytes, tags, metadata,
               created_at,
               (SELECT COUNT(*) FROM artifact_chunks c WHERE c.artifact_id = a.id) AS chunk_count
          FROM artifacts a
          ${where}
          ORDER BY created_at DESC
          OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`;
      const listResult = await conn.execute<Record<string, unknown>>(listSql, binds, {
        // OUT_FORMAT_OBJECT keeps column names as uppercase keys.
      });
      const countResult = await conn.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS cnt FROM artifacts a ${where}`,
        binds,
      );
      return {
        items: listResult.rows ?? [],
        total: (countResult.rows?.[0] as unknown as number[] | undefined)?.[0] ?? 0,
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
      const result = await conn.execute<{
        ID: string;
        OBJECT_NAME: string;
        BUCKET: string;
      }>(
        `SELECT id, kind, origin, title, notebook_id, artifact_id, bucket,
                object_name, mime_type, size_bytes, tags, metadata, created_at
           FROM artifacts WHERE id = :id`,
        { id },
        {},
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
    res.json({
      artifact: row,
      downloadUrl: `https://objectstorage.${cfg.ociRegion}.oraclecloud.com${par.fullPath}`,
      expiresAt: par.expiresAt.toISOString(),
    });
  }),
);
