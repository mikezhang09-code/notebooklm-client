/**
 * Analyze — ask a question about a source. Streams progress, returns the
 * full answer once the underlying workflow finishes.
 */

import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { SourceInput } from 'notebooklm-client';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { openSseStream } from '../lib/sse.js';

export const analyzeRouter = Router();

// Disk storage (NOT memory) — the notebooklm-client lib's `SourceInput`
// of type `'file'` requires an on-disk `filePath`. Without an explicit
// `dest`, multer 1.x silently falls back to memoryStorage and
// `req.file.path` is undefined, which surfaces downstream as the
// "Invalid source — provide url, text, file upload, …" error.
const upload = multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });

interface AnalyzeBody {
  source?: {
    type: 'url' | 'text' | 'file' | 'research';
    url?: string;
    text?: string;
    topic?: string;
    researchMode?: 'fast' | 'deep';
  };
  question?: string;
}

function buildSource(body: AnalyzeBody, filePath: string | undefined): SourceInput {
  const s = body.source;
  if (s?.type === 'url' && s.url) return { type: 'url', url: s.url };
  if (s?.type === 'text' && s.text) return { type: 'text', text: s.text };
  if (s?.type === 'file' && filePath) return { type: 'file', filePath };
  if (s?.type === 'research' && s.topic) {
    return { type: 'research', topic: s.topic, researchMode: s.researchMode ?? 'fast' };
  }
  throw new Error('Invalid source — provide url, text, file upload, or research topic');
}

analyzeRouter.post(
  '/',
  upload.single('file'),
  async (req, res, next) => {
    const stream = openSseStream(res);
    let file: { path: string } | undefined;
    try {
      file = (req as unknown as { file?: { path: string } }).file;
      const session = parseSessionHeader(req);
      const payload = (req.body as Record<string, unknown> | undefined)?.['payload'];
      const body: AnalyzeBody =
        typeof payload === 'string'
          ? (JSON.parse(payload) as AnalyzeBody)
          : ((req.body ?? {}) as AnalyzeBody);

      if (!body.question || typeof body.question !== 'string') {
        throw new Error('Missing question');
      }
      const source = buildSource(body, file?.path);

      const result = await withClient({ session }, (client) =>
        client.runAnalyze({ source, question: body.question as string }, (p) => {
          stream.progress(p);
        }),
      );

      stream.result({
        downloads: [],
        primary: [],
        meta: { answer: result.answer, notebookUrl: result.notebookUrl },
      });
    } catch (err) {
      if (!stream.closed) {
        stream.error(err instanceof Error ? err.message : String(err));
      } else {
        next(err);
      }
    } finally {
      if (file?.path) {
        try { await unlink(file.path); } catch { /* ignore */ }
      }
    }
  },
);
