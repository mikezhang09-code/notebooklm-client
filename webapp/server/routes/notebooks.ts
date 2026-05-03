/**
 * Notebook library: list / detail / delete + artifact listing + artifact download.
 */

import { basename } from 'node:path';
import { Router } from 'express';
import { ARTIFACT_TYPE } from 'notebooklm-client';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { createJob } from '../lib/job-store.js';

export const notebooksRouter = Router();

const ARTIFACT_TYPE_LABEL: Record<number, string> = {
  [ARTIFACT_TYPE.AUDIO]: 'audio',
  [ARTIFACT_TYPE.REPORT]: 'report',
  [ARTIFACT_TYPE.VIDEO]: 'video',
  [ARTIFACT_TYPE.QUIZ]: 'quiz',
  [ARTIFACT_TYPE.MIND_MAP]: 'mind-map',
  [ARTIFACT_TYPE.INFOGRAPHIC]: 'infographic',
  [ARTIFACT_TYPE.SLIDE_DECK]: 'slides',
  [ARTIFACT_TYPE.DATA_TABLE]: 'data-table',
};

notebooksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const notebooks = await withClient({ session }, (client) => client.listNotebooks());
    res.json({ notebooks });
  }),
);

notebooksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const id = req.params.id;
    const result = await withClient({ session }, async (client) => {
      const [detail, artifactsRaw] = await Promise.all([
        client.getNotebookDetail(id),
        client.getArtifacts(id).catch(() => [] as Awaited<ReturnType<typeof client.getArtifacts>>),
      ]);
      const artifacts = artifactsRaw.map((a) => ({
        ...a,
        typeLabel: ARTIFACT_TYPE_LABEL[a.type] ?? `type:${a.type}`,
      }));
      return { ...detail, artifacts };
    });
    res.json(result);
  }),
);

notebooksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    await withClient({ session }, (client) => client.deleteNotebook(req.params.id));
    res.json({ ok: true });
  }),
);

/**
 * Download an existing artifact (audio, report, quiz, flashcards,
 * infographic, slides, data-table, or video) into a per-job temp dir.
 *
 * The actual bytes are served by `/api/files/:jobId/:filename`.
 */
notebooksRouter.post(
  '/:id/artifacts/:artifactId/download',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const { id, artifactId } = req.params;
    const job = await createJob();
    const result = await withClient({ session }, (client) =>
      client.downloadArtifact(id, artifactId, job.dir),
    );
    const files = result.files.map((p) => {
      const name = basename(p);
      return { name, url: `/api/files/${job.id}/${encodeURIComponent(name)}` };
    });
    res.json({
      jobId: job.id,
      type: result.type,
      typeLabel: result.typeLabel,
      files,
      ...(result.streamUrl ? { streamUrl: result.streamUrl } : {}),
    });
  }),
);
