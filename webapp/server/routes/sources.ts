/**
 * Source management: add url/text/file sources to a notebook.
 * File uploads are buffered to a temp file, then passed to the library as a path.
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader, SessionHeaderError } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { NotebookClient } from 'notebooklm-client';

interface SourceAddOpts {
  file?: string;
  url?: string;
  text?: string;
  title?: string;
}

function validateSourceAddOpts(opts: SourceAddOpts): void {
  const provided = [opts.file, opts.url, opts.text].filter((v) => v !== undefined).length;
  if (provided !== 1) throw new SessionHeaderError('Specify exactly one of file, url, or text', 400);
  if (opts.text !== undefined && opts.text.trim().length === 0) {
    throw new SessionHeaderError('text must not be empty', 400);
  }
  if (opts.title !== undefined && opts.text === undefined) {
    throw new SessionHeaderError('title only applies to text', 400);
  }
}

async function runSourceAdd(
  client: NotebookClient,
  notebookId: string,
  opts: SourceAddOpts,
): Promise<{ sourceId: string; title: string }> {
  if (opts.file !== undefined) return client.addFileSource(notebookId, opts.file);
  if (opts.url !== undefined) return client.addUrlSource(notebookId, opts.url);
  return client.addTextSource(notebookId, opts.title ?? 'Pasted Text', opts.text as string);
}

export const sourcesRouter = Router({ mergeParams: true });

// Disk storage (NOT memory) — `addFileSource()` requires an on-disk path.
// `dest: undefined` is falsy and would silently fall back to memoryStorage;
// pass an explicit tmpdir() so `req.file.path` is populated.
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

sourcesRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const notebookId = req.params.id;
    if (!notebookId) throw new SessionHeaderError('Missing notebook id', 400);

    const body = (req.body ?? {}) as { url?: string; text?: string; title?: string };
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    const opts = {
      file: file?.path,
      url: body.url,
      text: body.text,
      title: body.title,
    };
    try {
      validateSourceAddOpts(opts);
      const result = await withClient({ session }, (client) =>
        runSourceAdd(client, notebookId, opts),
      );
      res.json(result);
    } finally {
      if (file?.path) {
        try { await unlink(file.path); } catch { /* ignore */ }
      }
    }
  }),
);
