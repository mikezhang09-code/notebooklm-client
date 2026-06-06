/**
 * Notebook library: list / detail / delete + artifact listing + artifact download.
 */

import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { ARTIFACT_TYPE } from 'notebooklm-client';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';
import { createJob } from '../lib/job-store.js';
import { getCorpusConfig } from '../corpus/index.js';
import {
  ingestArtifactWith,
  type ArtifactKind as CorpusKind,
} from '../corpus/ingest.js';

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

/**
 * Map a download result's typeLabel to a corpus-compatible kind.
 * Returns null for artifact types we don't persist in the corpus
 * (e.g. mind-map, which is a live URL rather than a downloadable blob).
 */
function typeLabelToCorpusKind(label: string): CorpusKind | null {
  switch (label) {
    case 'audio':
      return 'audio';
    case 'report':
      return 'report';
    case 'video':
      return 'video';
    case 'quiz':
      return 'quiz';
    case 'infographic':
      return 'infographic';
    case 'slides':
      return 'slides';
    case 'data-table':
      return 'data_table';
    default:
      return null; // mind-map, unknown types → skip
  }
}

/**
 * Pick the single file from a multi-file artifact that's most useful
 * for text-extraction in the corpus: PDF > DOCX > HTML > MD > first.
 * (Slides in particular download both .pptx and .pdf — the PDF gives
 * noticeably better text extraction than pdf-parse over .pptx.)
 */
function pickPrimaryFile(files: string[]): string | null {
  if (files.length === 0) return null;
  const prio: Record<string, number> = {
    '.pdf': 0,
    '.docx': 1,
    '.html': 2,
    '.htm': 2,
    '.md': 3,
    '.txt': 4,
    '.csv': 5,
    '.json': 6,
    '.pptx': 7,
    '.mp3': 8,
    '.wav': 8,
    '.m4a': 8,
    '.mp4': 9,
  };
  return [...files].sort((a, b) => {
    const pa = prio[extname(a).toLowerCase()] ?? 99;
    const pb = prio[extname(b).toLowerCase()] ?? 99;
    return pa - pb;
  })[0] ?? files[0] ?? null;
}

/** Map a file extension to a best-guess MIME type for corpus ingest. */
function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  switch (e) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.md':
      return 'text/markdown';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.mp4':
      return 'video/mp4';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

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
    // Optional hints from the UI so the corpus gets a meaningful title.
    // Fall back to generic placeholders when the client doesn't send them.
    const body = (req.body ?? {}) as {
      notebookTitle?: string;
      artifactTitle?: string;
    };
    const job = await createJob();
    const result = await withClient({ session }, (client) =>
      client.downloadArtifact(id, artifactId, job.dir),
    );
    const files = result.files.map((p) => {
      const name = basename(p);
      return { name, url: `/api/files/${job.id}/${encodeURIComponent(name)}` };
    });

    // ── Auto-ingest to corpus (fire-and-forget) ─────────────────────────
    // Runs asynchronously so the download response isn't blocked by the
    // embed round-trip (~3-10s). Errors are logged but never surfaced to
    // the user — the primary download already succeeded.
    let corpusStatus: 'scheduled' | 'disabled' | 'skipped_kind' | 'no_file' =
      'no_file';
    const cfg = await getCorpusConfig();
    if (!cfg) {
      corpusStatus = 'disabled';
    } else {
      const primary = pickPrimaryFile(result.files);
      let corpusKind = typeLabelToCorpusKind(result.typeLabel);
      // NotebookLM uses one artifact type for both quiz and flashcards, so the
      // typeLabel comes back as 'quiz'. Disambiguate via the saved filename
      // (saveQuizHtml prefixes flashcards as "flashcards_…") or the title.
      if (
        corpusKind === 'quiz' &&
        /flashcard/i.test(`${primary ? basename(primary) : ''} ${body.artifactTitle ?? ''}`)
      ) {
        corpusKind = 'flashcards';
      }
      if (!corpusKind) {
        corpusStatus = 'skipped_kind';
      } else if (!primary) {
        corpusStatus = 'no_file';
      } else {
        corpusStatus = 'scheduled';
        const primaryName = basename(primary);
        const derivedTitle =
          [body.notebookTitle, result.typeLabel].filter(Boolean).join(' — ') ||
          `${result.typeLabel} ${primaryName}`;
        const title = body.artifactTitle ?? derivedTitle;
        // Fire-and-forget — don't await.
        void (async () => {
          try {
            const buffer = await readFile(primary);
            const r = await ingestArtifactWith(cfg, {
              buffer,
              title: title.slice(0, 512),
              kind: corpusKind,
              origin: 'notebooklm',
              mimeType: mimeFromExt(extname(primaryName)),
              filename: primaryName,
              notebookId: id,
              artifactId,
              tags: [result.typeLabel],
              metadata: {
                jobId: job.id,
                notebookTitle: body.notebookTitle ?? null,
                downloadedAt: new Date().toISOString(),
              },
            });
            console.log(
              `[corpus] auto-ingested ${r.id} (${r.chunkCount} chunks${
                r.alreadyIngested ? ', dedup' : ''
              }) kind=${corpusKind} nb=${id} aid=${artifactId}`,
            );
          } catch (err) {
            console.error(
              '[corpus] auto-ingest failed',
              { notebookId: id, artifactId, typeLabel: result.typeLabel },
              err instanceof Error ? err.message : err,
            );
          }
        })();
      }
    }

    res.json({
      jobId: job.id,
      type: result.type,
      typeLabel: result.typeLabel,
      files,
      corpus: { status: corpusStatus },
      ...(result.streamUrl ? { streamUrl: result.streamUrl } : {}),
    });
  }),
);
