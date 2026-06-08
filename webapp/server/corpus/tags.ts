/**
 * Tag normalisation + group-tag inheritance/propagation.
 *
 * A "group" is a notebook or a collection. Group tags propagate onto the
 * artifacts that belong to the group, but each artifact may also carry its own
 * manually-added tags. To keep the two cleanly separable — so editing a group's
 * tags doesn't clobber per-artifact tags, and removing a group tag removes only
 * that one — we record the slice that came from the group in
 * `metadata.inheritedTags`. The visible `artifacts.tags` column is always the
 * union (manual ∪ inherited).
 */

import oracledb from 'oracledb';
import type { Connection } from 'oracledb';

/** Max tags per artifact + max length per tag. Mirrors the PATCH route limits. */
const MAX_TAGS = 32;
const MAX_TAG_LEN = 32;

/** Lowercase, trim, drop empties/overlong, dedupe, cap. Order-preserving. */
export function cleanTags(tags: Iterable<string> | undefined | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const t = String(raw).trim().toLowerCase();
    if (!t || t.length > MAX_TAG_LEN || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Parse a JSON `tags` value (already-array, JSON string, or null) into string[]. */
export function parseTagArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Parse a JSON `metadata` value into a plain object (never null). */
export function parseMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

/**
 * Pure re-merge for one artifact: keep its manual tags (current minus the
 * previously-inherited set), then layer the new inherited set on top.
 * Returns the new visible tag list and the new inherited slice to persist.
 */
export function mergeInheritedTags(
  current: string[],
  oldInherited: string[],
  newInherited: string[],
): { tags: string[]; inherited: string[] } {
  const inherited = cleanTags(newInherited);
  const oldSet = new Set(oldInherited.map((t) => t.toLowerCase()));
  const manual = current.filter((t) => !oldSet.has(t.toLowerCase()));
  return { tags: cleanTags([...manual, ...inherited]), inherited };
}

/** The group's persisted tags, for a freshly-ingested artifact to inherit. */
export async function inheritedTagsForIngest(
  conn: Connection,
  scope: { collectionId?: string; notebookId?: string },
): Promise<string[]> {
  // A collection grouping (explicit user upload) takes precedence over the
  // notebook grouping if somehow both are set.
  if (scope.collectionId) {
    return groupTags(conn, 'collections', scope.collectionId);
  }
  if (scope.notebookId) {
    return groupTags(conn, 'notebooks', scope.notebookId);
  }
  return [];
}

/**
 * Read + clean the `tags` of a single collections/notebooks row. Tolerates the
 * table not existing yet (ORA-00942) — the `notebooks` table is created by a
 * later migration, and ingest must keep working before it's applied.
 */
async function groupTags(
  conn: Connection,
  table: 'collections' | 'notebooks',
  id: string,
): Promise<string[]> {
  try {
    const r = await conn.execute<{ TAGS: unknown }>(
      `SELECT tags FROM ${table} WHERE id = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return cleanTags(parseTagArray(r.rows?.[0]?.TAGS));
  } catch (err) {
    if (/ORA-00942/i.test(err instanceof Error ? err.message : String(err))) {
      return [];
    }
    throw err;
  }
}

/**
 * Propagate a group's tags onto every artifact in the group. Re-reads each
 * artifact, swaps its previously-inherited slice for `groupTags` (preserving
 * manual tags), and rewrites `tags` + `metadata.inheritedTags`.
 *
 * `column` is a fixed internal literal (never user input) — safe to inline.
 * Runs on the caller's connection WITHOUT committing, so it can join a larger
 * transaction; the caller commits.
 */
export async function resyncGroupTags(
  conn: Connection,
  column: 'collection_id' | 'notebook_id',
  id: string,
  groupTags: string[],
): Promise<number> {
  const cleaned = cleanTags(groupTags);
  const sel = await conn.execute<{ ID: string; TAGS: unknown; METADATA: unknown }>(
    `SELECT id, tags, metadata FROM artifacts WHERE ${column} = :id`,
    { id },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const rows = sel.rows ?? [];
  for (const r of rows) {
    await writeMergedTags(conn, r.ID, parseTagArray(r.TAGS), parseMeta(r.METADATA), cleaned);
  }
  return rows.length;
}

/**
 * Re-merge a single artifact's inherited slice (used when an artifact moves
 * between groups). Pass an empty `groupTags` to strip inherited tags entirely.
 */
export async function resyncSingleArtifact(
  conn: Connection,
  artifactId: string,
  groupTags: string[],
): Promise<boolean> {
  const sel = await conn.execute<{ TAGS: unknown; METADATA: unknown }>(
    `SELECT tags, metadata FROM artifacts WHERE id = :id`,
    { id: artifactId },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const row = sel.rows?.[0];
  if (!row) return false;
  await writeMergedTags(
    conn,
    artifactId,
    parseTagArray(row.TAGS),
    parseMeta(row.METADATA),
    cleanTags(groupTags),
  );
  return true;
}

/** Shared write step for the two resync entry points. Does not commit. */
async function writeMergedTags(
  conn: Connection,
  artifactId: string,
  currentTags: string[],
  meta: Record<string, unknown>,
  groupTags: string[],
): Promise<void> {
  const oldInherited = parseTagArray(meta['inheritedTags']);
  const { tags, inherited } = mergeInheritedTags(currentTags, oldInherited, groupTags);
  if (inherited.length > 0) meta['inheritedTags'] = inherited;
  else delete meta['inheritedTags'];
  await conn.execute(
    `UPDATE artifacts SET tags = :tags, metadata = :meta, updated_at = SYSTIMESTAMP WHERE id = :id`,
    { tags: JSON.stringify(tags), meta: JSON.stringify(meta), id: artifactId },
    { autoCommit: false },
  );
}
