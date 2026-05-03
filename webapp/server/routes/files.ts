/**
 * Download endpoint for artefacts produced by generation jobs.
 * Files are stored in per-job temp dirs allocated by `job-store`.
 */

import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { getJob } from '../lib/job-store.js';
import { asyncHandler } from '../lib/handler.js';

export const filesRouter = Router();

filesRouter.get(
  '/:jobId/:filename',
  asyncHandler(async (req, res) => {
    const { jobId, filename } = req.params;
    if (!jobId || !filename) {
      res.status(400).json({ error: 'Missing jobId or filename' });
      return;
    }
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found or expired' });
      return;
    }
    // Prevent path traversal — filename must resolve inside the job dir.
    const safeName = basename(filename);
    const fullPath = resolve(join(job.dir, safeName));
    if (!fullPath.startsWith(resolve(job.dir))) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    let size: number;
    try {
      const s = await stat(fullPath);
      if (!s.isFile()) {
        res.status(404).json({ error: 'Not a file' });
        return;
      }
      size = s.size;
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = createReadStream(fullPath);
    // Clean up the read stream if the client disconnects or the response errors,
    // and swallow the fs error so Node doesn't crash on unhandled 'error' events.
    stream.on('error', (err) => {
      console.error(`[files] read stream error for ${safeName}:`, err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    res.on('close', () => {
      if (!stream.destroyed) stream.destroy();
    });
    stream.pipe(res);
  }),
);
