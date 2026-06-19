/**
 * Export a collection's artifacts as individual NotebookLM sources.
 *
 * Unlike `collection-context.ts` (which folds every artifact into ONE capped
 * text source for a throwaway notebook), this module plans a *persistent*
 * NotebookLM notebook where each compatible artifact becomes its own source —
 * preserving per-source citation boundaries.
 *
 * This module owns only the corpus side: artifact selection, per-kind
 * classification, and loading each source's content from Object Storage. The
 * NotebookLM orchestration (createNotebook / addFileSource / addTextSource)
 * lives in the route, so the corpus layer stays decoupled from the client lib.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { getObjectBuffer } from './oci/storage.js';
import { extract } from './extract/index.js';

/** NotebookLM free-tier per-notebook source cap. */
export const NOTEBOOKLM_SOURCE_LIMIT = 50;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * MIME types NotebookLM accepts as *file* uploads and that carry their own
 * formatting worth preserving (mirrors `src/api.ts` `fileMimeType`, minus the
 * image types — image-only artifacts are skipped per the export contract).
 */
const FILE_SOURCE_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/epub+zip',
  'text/csv',
]);

export type SourceMode = 'file' | 'text';

export interface ExportEntry {
  id: string;
  title: string;
  kind: string;
  objectName: string;
  mimeType: string | null;
  mode: SourceMode;
}

export interface SkippedEntry {
  id: string;
  title: string;
  reason: 'image' | 'empty' | 'over_limit';
}

export interface ExportPlan {
  collectionName: string;
  tags: string[];
  eligible: ExportEntry[];
  skipped: SkippedEntry[];
  /** True iff the eligible set was truncated to the source limit. */
  capped: boolean;
}

interface ArtifactRow {
  ID: string;
  TITLE: string;
  KIND: string;
  OBJECT_NAME: string;
  MIME_TYPE: string | null;
}

/**
 * Decide how an artifact should enter NotebookLM:
 *  • image/*                      → skip (low-value as a source)
 *  • doc/pdf/pptx/csv/audio/...   → file upload (preserves formatting)
 *  • everything else              → text source (extract() the bytes)
 */
function classify(mimeType: string | null, objectName: string): SourceMode | 'skip_image' {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'skip_image';
  if (mime.startsWith('audio/')) return 'file';
  if (FILE_SOURCE_MIME.has(mime)) return 'file';
  // Fall back to the file extension when MIME is generic (octet-stream uploads).
  const ext = extname(basename(objectName)).toLowerCase();
  if (['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.epub', '.csv', '.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) {
    return 'file';
  }
  return 'text';
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t));
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map((t) => String(t)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Build an export plan for a collection: which artifacts become sources (and
 * how), which are skipped, and whether the source cap truncated the set.
 * `fileIds` (validated ULIDs) restricts to a subset; empty = the whole
 * collection. Artifacts are ordered oldest-first so the cap is deterministic.
 */
export async function planCollectionExport(
  cfg: CorpusConfig,
  collectionId: string,
  fileIds: string[],
): Promise<ExportPlan> {
  const ids = fileIds.filter((x) => ULID_RE.test(x));
  return withConnection(cfg, async (conn) => {
    const head = await conn.execute<{ NAME: string; TAGS: unknown }>(
      `SELECT name, tags FROM collections WHERE id = :id`,
      { id: collectionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const meta = head.rows?.[0];
    if (!meta) throw new Error('collection not found');

    const rowsRes = await conn.execute<ArtifactRow>(
      ids.length > 0
        ? `SELECT id, title, kind, object_name, mime_type FROM artifacts
             WHERE collection_id = :c AND id IN (${ids.map((_, i) => `:f${i}`).join(',')})
             ORDER BY created_at ASC`
        : `SELECT id, title, kind, object_name, mime_type FROM artifacts
             WHERE collection_id = :c ORDER BY created_at ASC`,
      ids.length > 0
        ? { c: collectionId, ...Object.fromEntries(ids.map((id, i) => [`f${i}`, id])) }
        : { c: collectionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const eligible: ExportEntry[] = [];
    const skipped: SkippedEntry[] = [];
    for (const r of rowsRes.rows ?? []) {
      const mode = classify(r.MIME_TYPE, r.OBJECT_NAME);
      if (mode === 'skip_image') {
        skipped.push({ id: r.ID, title: r.TITLE, reason: 'image' });
        continue;
      }
      eligible.push({
        id: r.ID,
        title: r.TITLE,
        kind: r.KIND,
        objectName: r.OBJECT_NAME,
        mimeType: r.MIME_TYPE,
        mode,
      });
    }

    // Apply the source cap (oldest kept, rest reported as over_limit).
    let capped = false;
    if (eligible.length > NOTEBOOKLM_SOURCE_LIMIT) {
      capped = true;
      for (const e of eligible.slice(NOTEBOOKLM_SOURCE_LIMIT)) {
        skipped.push({ id: e.id, title: e.title, reason: 'over_limit' });
      }
      eligible.length = NOTEBOOKLM_SOURCE_LIMIT;
    }

    return {
      collectionName: meta.NAME,
      tags: parseTags(meta.TAGS),
      eligible,
      skipped,
      capped,
    };
  });
}

export type LoadedSource =
  | { mode: 'file'; filePath: string; title: string; cleanup: () => Promise<void> }
  | { mode: 'text'; title: string; text: string };

/** Sanitise an artifact title into a safe on-disk filename (keeps it readable
 *  so NotebookLM shows a meaningful source name). */
function safeFileName(title: string, ext: string): string {
  const base = (title || 'source')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'source';
  return ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
}

/**
 * Resolve an eligible entry into the content NotebookLM needs:
 *  • file mode → download bytes, write a temp file named after the artifact
 *    (with a correct extension) and return its path + a cleanup().
 *  • text mode → extract() the bytes to plain text. Throws when extraction
 *    yields nothing (caller treats this as a skip).
 */
export async function loadExportSource(
  cfg: CorpusConfig,
  entry: ExportEntry,
): Promise<LoadedSource> {
  const buffer = await getObjectBuffer(cfg, entry.objectName);
  if (entry.mode === 'file') {
    const ext = extname(basename(entry.objectName)) || '';
    const dir = await mkdtemp(join(tmpdir(), 'nblm-exp-'));
    const filePath = join(dir, safeFileName(entry.title, ext) || `${randomUUID()}${ext}`);
    await writeFile(filePath, buffer);
    return {
      mode: 'file',
      filePath,
      title: entry.title,
      cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
    };
  }
  const text = (await extract(buffer, entry.mimeType ?? undefined, entry.objectName)).trim();
  if (!text) throw new Error('no extractable text');
  return { mode: 'text', title: entry.title, text };
}
