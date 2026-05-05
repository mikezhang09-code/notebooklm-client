/**
 * Corpus semantic search.
 *
 *   query → embed (SEARCH_QUERY) → SQL VECTOR_DISTANCE COSINE kNN
 *     → group hits by artifact → return top N artifacts each with the
 *       chunks that matched (ordered by distance).
 *
 * The function is shape-stable — it returns the same JSON the HTTP route
 * surfaces, so the React side can call this directly through the route
 * without a translation layer.
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { embedTexts } from './oci/genai.js';

export interface SearchOptions {
  /** User-provided natural-language query. */
  query: string;
  /** Optional kind filter (single value). */
  kind?: string;
  /** Optional notebook filter. */
  notebookId?: string;
  /** Maximum chunks to look at before grouping. Default 40, max 200. */
  candidateLimit?: number;
  /** Maximum artifacts to return after grouping. Default 10, max 50. */
  artifactLimit?: number;
  /** Maximum chunks per artifact in the response. Default 3, max 10. */
  snippetsPerArtifact?: number;
  /**
   * Distance threshold above which hits are filtered out.
   * Cosine distance: 0 = identical, 1 = orthogonal, 2 = opposite.
   * Empirically: relevant hits are ≤ 0.65, junk is ≥ 0.75.
   * Default: no threshold (return everything sorted by distance).
   */
  maxDistance?: number;
}

export interface SearchSnippet {
  chunkId: string;
  ordinal: number;
  distance: number;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface SearchHit {
  artifact: {
    id: string;
    kind: string;
    origin: string;
    title: string;
    notebookId: string | null;
    artifactId: string | null;
    bucket: string;
    objectName: string;
    mimeType: string | null;
    sizeBytes: number;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
  };
  /** Best (lowest) cosine distance across the artifact's chunks. */
  bestDistance: number;
  /** Top chunks for this artifact, ordered by distance. */
  snippets: SearchSnippet[];
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  /** Diagnostic — how many chunks were looked at server-side before grouping. */
  candidatesScanned: number;
  /** ms spent embedding the query. */
  embedMs: number;
  /** ms spent on the SQL kNN call. */
  sqlMs: number;
}

/** Internal row shape from the candidate kNN query. */
interface CandidateRow {
  CHUNK_ID: string;
  ARTIFACT_ID: string;
  ORDINAL: number;
  DIST: number;
  TEXT: string;
  CHAR_START: number;
  CHAR_END: number;
}

/** Internal row shape from the artifact lookup query. */
interface ArtifactRow {
  ID: string;
  KIND: string;
  ORIGIN: string;
  TITLE: string;
  NOTEBOOK_ID: string | null;
  ARTIFACT_ID: string | null;
  BUCKET: string;
  OBJECT_NAME: string;
  MIME_TYPE: string | null;
  SIZE_BYTES: number;
  TAGS: unknown;
  METADATA: unknown;
  CREATED_AT: Date;
}

function clamp(value: number | undefined, def: number, min: number, max: number): number {
  if (value == null || Number.isNaN(value)) return def;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Run a semantic search. Returns artifact-grouped hits ordered by their
 * best chunk distance (ascending, so most-relevant first).
 */
export async function searchCorpus(
  cfg: CorpusConfig,
  opts: SearchOptions,
): Promise<SearchResult> {
  const query = opts.query.trim();
  if (query.length === 0) {
    return {
      query,
      hits: [],
      candidatesScanned: 0,
      embedMs: 0,
      sqlMs: 0,
    };
  }

  const candidateLimit = clamp(opts.candidateLimit, 40, 1, 200);
  const artifactLimit = clamp(opts.artifactLimit, 10, 1, 50);
  const snippetsPerArtifact = clamp(opts.snippetsPerArtifact, 3, 1, 10);

  // 1) Embed the query as a SEARCH_QUERY (different normalization than docs).
  const tEmbed = Date.now();
  const [qvec] = await embedTexts(cfg, [query], 'SEARCH_QUERY');
  if (!qvec) {
    return {
      query,
      hits: [],
      candidatesScanned: 0,
      embedMs: Date.now() - tEmbed,
      sqlMs: 0,
    };
  }
  const qv = Float32Array.from(qvec);
  const embedMs = Date.now() - tEmbed;

  // 2) kNN over chunks (with optional kind / notebookId filters via JOIN).
  const filters: string[] = [];
  const filterBinds: Record<string, string> = {};
  if (opts.kind) {
    filters.push('a.kind = :f_kind');
    filterBinds['f_kind'] = opts.kind;
  }
  if (opts.notebookId) {
    filters.push('a.notebook_id = :f_nb');
    filterBinds['f_nb'] = opts.notebookId;
  }
  const filterSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // We scan more candidates than we'll ultimately return so that grouping by
  // artifact still leaves us with a healthy artifactLimit-sized result set.
  const sqlStart = Date.now();
  const rows = await withConnection(cfg, async (conn) => {
    const result = await conn.execute<CandidateRow>(
      `SELECT c.id          AS chunk_id,
              c.artifact_id AS artifact_id,
              c.ordinal     AS ordinal,
              VECTOR_DISTANCE(c.embedding, :qv, COSINE) AS dist,
              SUBSTR(c.text, 1, 1200) AS text,
              c.char_start  AS char_start,
              c.char_end    AS char_end
         FROM artifact_chunks c
         JOIN artifacts a ON a.id = c.artifact_id
         ${filterSql}
         ORDER BY dist
         FETCH FIRST :cap ROWS ONLY`,
      { qv, cap: candidateLimit, ...filterBinds } as unknown as oracledb.BindParameters,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  });
  const sqlMs = Date.now() - sqlStart;

  // 3) Filter by maxDistance (if set) and group by artifact_id.
  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (opts.maxDistance != null && row.DIST > opts.maxDistance) continue;
    const list = groups.get(row.ARTIFACT_ID) ?? [];
    list.push(row);
    groups.set(row.ARTIFACT_ID, list);
  }

  if (groups.size === 0) {
    return { query, hits: [], candidatesScanned: rows.length, embedMs, sqlMs };
  }

  // 4) Look up artifact metadata for the surviving artifact_ids in one query.
  const artifactIds = Array.from(groups.keys()).slice(0, artifactLimit * 2);
  // Build IN-list with bind placeholders to keep things parameterised.
  const inBinds: Record<string, string> = {};
  const inPlaceholders: string[] = [];
  artifactIds.forEach((id, idx) => {
    const k = `aid${idx}`;
    inBinds[k] = id;
    inPlaceholders.push(`:${k}`);
  });

  const artifactRows = await withConnection(cfg, async (conn) => {
    const result = await conn.execute<ArtifactRow>(
      `SELECT id, kind, origin, title, notebook_id, artifact_id,
              bucket, object_name, mime_type, size_bytes,
              tags, metadata, created_at
         FROM artifacts
        WHERE id IN (${inPlaceholders.join(', ')})`,
      inBinds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return result.rows ?? [];
  });

  const artifactMap = new Map<string, ArtifactRow>(
    artifactRows.map((r) => [r.ID, r]),
  );

  // 5) Build the response, sort by best distance per artifact, cap snippets.
  const hits: SearchHit[] = [];
  for (const [aid, chunks] of groups) {
    const artifactRow = artifactMap.get(aid);
    if (!artifactRow) continue; // shouldn't happen but be safe
    chunks.sort((a, b) => a.DIST - b.DIST);
    const top = chunks.slice(0, snippetsPerArtifact);
    hits.push({
      artifact: {
        id: artifactRow.ID,
        kind: artifactRow.KIND,
        origin: artifactRow.ORIGIN,
        title: artifactRow.TITLE,
        notebookId: artifactRow.NOTEBOOK_ID,
        artifactId: artifactRow.ARTIFACT_ID,
        bucket: artifactRow.BUCKET,
        objectName: artifactRow.OBJECT_NAME,
        mimeType: artifactRow.MIME_TYPE,
        sizeBytes: artifactRow.SIZE_BYTES,
        tags: safeParseJson<string[]>(artifactRow.TAGS, []),
        metadata: safeParseJson<Record<string, unknown>>(artifactRow.METADATA, {}),
        createdAt: artifactRow.CREATED_AT.toISOString(),
      },
      bestDistance: top[0]?.DIST ?? Number.POSITIVE_INFINITY,
      snippets: top.map((c) => ({
        chunkId: c.CHUNK_ID,
        ordinal: c.ORDINAL,
        distance: c.DIST,
        text: c.TEXT,
        charStart: c.CHAR_START,
        charEnd: c.CHAR_END,
      })),
    });
  }

  hits.sort((a, b) => a.bestDistance - b.bestDistance);

  return {
    query,
    hits: hits.slice(0, artifactLimit),
    candidatesScanned: rows.length,
    embedMs,
    sqlMs,
  };
}
