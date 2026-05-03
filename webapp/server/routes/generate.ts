/**
 * Generation endpoints — one POST per artefact kind. Each streams progress
 * over Server-Sent Events and finishes with a `result` event containing
 * download URLs for any files the workflow produced.
 */

import { Router } from 'express';
import multer from 'multer';
import { readdir, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import type { NotebookClient, SourceInput, WorkflowProgress } from 'notebooklm-client';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { openSseStream } from '../lib/sse.js';
import { createJob } from '../lib/job-store.js';

export const generateRouter = Router();

const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });

type Kind =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flashcards'
  | 'infographic'
  | 'slides'
  | 'data-table';

interface GenerateBody {
  source?: {
    type: 'url' | 'text' | 'file' | 'research';
    url?: string;
    text?: string;
    topic?: string;
    researchMode?: 'fast' | 'deep';
    // file is supplied as a multipart field
  };
  options?: Record<string, unknown>;
}

function buildSource(body: GenerateBody, filePath: string | undefined): SourceInput {
  const s = body.source;
  if (s?.type === 'url' && s.url) return { type: 'url', url: s.url };
  if (s?.type === 'text' && s.text) return { type: 'text', text: s.text };
  if (s?.type === 'file' && filePath) return { type: 'file', filePath };
  if (s?.type === 'research' && s.topic) {
    return { type: 'research', topic: s.topic, researchMode: s.researchMode ?? 'fast' };
  }
  throw new Error('Invalid source — provide url, text, file upload, or research topic');
}

interface WorkflowOutput {
  downloadPaths: string[];
  meta: Record<string, unknown>;
}

async function runWorkflow(
  client: NotebookClient,
  kind: Kind,
  source: SourceInput,
  outputDir: string,
  options: Record<string, unknown>,
  onProgress: (p: WorkflowProgress) => void,
): Promise<WorkflowOutput> {
  const opt = options as Record<string, string | undefined>;
  const lang = opt.language;
  const instructions = opt.instructions;
  switch (kind) {
    case 'audio': {
      const r = await client.runAudioOverview(
        {
          source,
          outputDir,
          language: opt.language as never,
          instructions,
          format: opt.format as never,
          length: opt.length as never,
        },
        onProgress,
      );
      return { downloadPaths: [r.audioPath], meta: { notebookUrl: r.notebookUrl } };
    }
    case 'report': {
      const r = await client.runReport(
        {
          source,
          outputDir,
          template: (opt.template ?? 'briefing_doc') as never,
          instructions,
          language: lang,
        },
        onProgress,
      );
      return { downloadPaths: [r.markdownPath], meta: { notebookUrl: r.notebookUrl } };
    }
    case 'video': {
      const r = await client.runVideo(
        {
          source,
          outputDir,
          format: opt.format as never,
          style: opt.style as never,
          instructions,
          language: lang,
        },
        onProgress,
      );
      // Video returns a remote URL, not a local file.
      return { downloadPaths: [], meta: { videoUrl: r.videoUrl, notebookUrl: r.notebookUrl } };
    }
    case 'quiz': {
      const r = await client.runQuiz(
        {
          source,
          outputDir,
          instructions,
          language: lang,
          quantity: opt.quantity as never,
          difficulty: opt.difficulty as never,
        },
        onProgress,
      );
      return { downloadPaths: [r.htmlPath], meta: { notebookUrl: r.notebookUrl } };
    }
    case 'flashcards': {
      const r = await client.runFlashcards(
        {
          source,
          outputDir,
          instructions,
          language: lang,
          quantity: opt.quantity as never,
          difficulty: opt.difficulty as never,
        },
        onProgress,
      );
      return { downloadPaths: [r.htmlPath], meta: { notebookUrl: r.notebookUrl, cards: r.cards } };
    }
    case 'infographic': {
      const r = await client.runInfographic(
        {
          source,
          outputDir,
          instructions,
          language: lang,
          orientation: opt.orientation as never,
          detail: opt.detail as never,
          style: opt.style as never,
        },
        onProgress,
      );
      return { downloadPaths: [r.imagePath], meta: { notebookUrl: r.notebookUrl } };
    }
    case 'slides': {
      const r = await client.runSlideDeck(
        {
          source,
          outputDir,
          instructions,
          language: lang,
          format: opt.format as never,
          length: opt.length as never,
        },
        onProgress,
      );
      const paths = [r.pptxPath];
      if (r.pdfPath) paths.push(r.pdfPath);
      return { downloadPaths: paths, meta: { notebookUrl: r.notebookUrl } };
    }
    case 'data-table': {
      const r = await client.runDataTable(
        { source, outputDir, instructions, language: lang },
        onProgress,
      );
      return { downloadPaths: [r.csvPath], meta: { notebookUrl: r.notebookUrl } };
    }
  }
}

generateRouter.post(
  '/:kind',
  upload.single('file'),
  async (req, res, next) => {
    const kind = req.params.kind as Kind;
    const stream = openSseStream(res);

    let file: { path: string } | undefined;
    try {
      file = (req as unknown as { file?: { path: string } }).file;
      const session = parseSessionHeader(req);

      // Body may be JSON in a `payload` field (multipart) or the plain body.
      let body: GenerateBody;
      const payload = (req.body as Record<string, unknown> | undefined)?.['payload'];
      if (typeof payload === 'string') {
        body = JSON.parse(payload) as GenerateBody;
      } else {
        body = (req.body ?? {}) as GenerateBody;
      }

      const source = buildSource(body, file?.path);
      const job = await createJob();

      stream.progress({ status: 'pending', message: `Starting ${kind} generation…` });

      const output = await withClient({ session }, (client) =>
        runWorkflow(client, kind, source, job.dir, body.options ?? {}, (p) => {
          stream.progress(p);
        }),
      );

      // Enumerate actual files in the job dir (workflows can emit extras).
      const allFiles = await readdir(job.dir).catch(() => [] as string[]);
      const downloads = allFiles.map((name) => ({
        name,
        url: `/api/files/${job.id}/${encodeURIComponent(name)}`,
      }));

      stream.result({
        jobId: job.id,
        downloads,
        primary: output.downloadPaths.map((p) => basename(p)),
        meta: output.meta,
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
