/**
 * Generation endpoints — one POST per artefact kind. Each streams progress
 * over Server-Sent Events and finishes with a `result` event containing
 * download URLs for any files the workflow produced.
 */

import { Router } from 'express';
import multer from 'multer';
import { readdir, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname } from 'node:path';
import type {
  NotebookClient,
  SourceInput,
  WorkflowProgress,
  ArtifactGenerateOptions,
} from 'notebooklm-client';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { openSseStream } from '../lib/sse.js';
import { createJob } from '../lib/job-store.js';

export const generateRouter = Router();

// Disk storage (NOT memory) — the notebooklm-client lib's `SourceInput`
// of type `'file'` requires an on-disk `filePath`. Without an explicit
// `dest`, multer 1.x falls back to memoryStorage and `req.file.path`
// is undefined, surfacing as "Invalid source — …" downstream.
const upload = multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });

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
  /** When set, generate into this existing notebook instead of a fresh one. */
  notebookId?: string;
  /** Subset of source IDs to use with `notebookId` (default: all sources). */
  sourceIds?: string[];
  options?: Record<string, unknown>;
}

/** Map a webapp artifact `kind` + raw options to a library ArtifactGenerateOptions. */
function buildArtifactOptions(kind: Kind, opt: Record<string, string | undefined>): ArtifactGenerateOptions {
  switch (kind) {
    case 'audio':
      return { type: 'audio', language: opt.language as never, instructions: opt.instructions, format: opt.format as never, length: opt.length as never };
    case 'report':
      return { type: 'report', template: (opt.template ?? 'briefing_doc') as never, instructions: opt.instructions, language: opt.language };
    case 'video':
      return { type: 'video', format: opt.format as never, style: opt.style as never, instructions: opt.instructions, language: opt.language };
    case 'quiz':
      return { type: 'quiz', instructions: opt.instructions, language: opt.language, quantity: opt.quantity as never, difficulty: opt.difficulty as never };
    case 'flashcards':
      return { type: 'flashcards', instructions: opt.instructions, language: opt.language, quantity: opt.quantity as never, difficulty: opt.difficulty as never };
    case 'infographic':
      return { type: 'infographic', instructions: opt.instructions, language: opt.language, orientation: opt.orientation as never, detail: opt.detail as never, style: opt.style as never };
    case 'slides':
      return { type: 'slide_deck', instructions: opt.instructions, language: opt.language, format: opt.format as never, length: opt.length as never };
    case 'data-table':
      return { type: 'data_table', instructions: opt.instructions, language: opt.language };
  }
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

    let file: { path: string; originalname?: string } | undefined;
    try {
      file = (req as unknown as { file?: { path: string; originalname?: string } }).file;

      // Multer strips the original extension from temp filenames (e.g. saves
      // "report.md" as "/tmp/abc123"). NotebookLM's file type detection and
      // Google's Scotty upload API both depend on the extension being present.
      // Rename the temp file before passing it downstream.
      if (file?.path && file.originalname) {
        const ext = extname(file.originalname);
        if (ext) {
          const renamedPath = file.path + ext;
          await rename(file.path, renamedPath);
          file = { ...file, path: renamedPath };
        }
      }

      const session = parseSessionHeader(req);

      // Body may be JSON in a `payload` field (multipart) or the plain body.
      let body: GenerateBody;
      const payload = (req.body as Record<string, unknown> | undefined)?.['payload'];
      if (typeof payload === 'string') {
        body = JSON.parse(payload) as GenerateBody;
      } else {
        body = (req.body ?? {}) as GenerateBody;
      }

      const job = await createJob();

      let output: WorkflowOutput;
      if (body.notebookId) {
        // ── Generate into an existing notebook (reuse its sources) ──
        stream.progress({ status: 'pending', message: `Starting ${kind} generation…` });
        const artifact = buildArtifactOptions(kind, (body.options ?? {}) as Record<string, string | undefined>);
        output = await withClient({ session }, async (client) => {
          const r = await client.runGenerateInNotebook(
            { notebookId: body.notebookId!, sourceIds: body.sourceIds, artifact, outputDir: job.dir },
            (p) => stream.progress(p),
          );
          return {
            downloadPaths: r.files,
            meta: { notebookUrl: r.notebookUrl, ...(r.streamUrl ? { streamUrl: r.streamUrl } : {}) },
          };
        });
      } else {
        // ── Create a fresh notebook from a supplied source ──
        const source = buildSource(body, file?.path);
        stream.progress({ status: 'pending', message: `Starting ${kind} generation…` });
        output = await withClient({ session }, (client) =>
          runWorkflow(client, kind, source, job.dir, body.options ?? {}, (p) => {
            stream.progress(p);
          }),
        );
      }

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
