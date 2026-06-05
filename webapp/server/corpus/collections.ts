/**
 * Collections — user-created groupings of uploaded artifacts.
 *
 * A collection is a row in `collections`; artifacts point at it via
 * `artifacts.collection_id` (NULL = free-form upload). Deleting a collection
 * demotes its artifacts to free-form (FK ON DELETE SET NULL).
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { newId } from './ulid.js';

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  itemCount: number;
  /** kind → count, for the mini type tiles on the card. */
  breakdown: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionFile {
  id: string;
  kind: string;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface CollectionDetail extends CollectionSummary {
  files: CollectionFile[];
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

/** List all collections with item counts + a per-kind breakdown. */
export async function listCollections(cfg: CorpusConfig): Promise<CollectionSummary[]> {
  return withConnection(cfg, async (conn) => {
    const rows = await conn.execute<{
      ID: string;
      NAME: string;
      DESCRIPTION: string | null;
      TAGS: unknown;
      ITEM_COUNT: number;
      CREATED_AT: Date;
      UPDATED_AT: Date;
    }>(
      `SELECT c.id, c.name, c.description, c.tags,
              (SELECT COUNT(*) FROM artifacts a WHERE a.collection_id = c.id) AS item_count,
              c.created_at, c.updated_at
         FROM collections c
        ORDER BY c.updated_at DESC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    // Per-collection kind breakdown in one grouped pass.
    const breakdownRows = await conn.execute<{
      COLLECTION_ID: string;
      KIND: string;
      CNT: number;
    }>(
      `SELECT collection_id, kind, COUNT(*) AS cnt
         FROM artifacts
        WHERE collection_id IS NOT NULL
        GROUP BY collection_id, kind`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const breakdowns = new Map<string, Record<string, number>>();
    for (const r of breakdownRows.rows ?? []) {
      const m = breakdowns.get(r.COLLECTION_ID) ?? {};
      m[r.KIND] = Number(r.CNT);
      breakdowns.set(r.COLLECTION_ID, m);
    }

    return (rows.rows ?? []).map((r) => ({
      id: r.ID,
      name: r.NAME,
      description: r.DESCRIPTION,
      tags: parseTags(r.TAGS),
      itemCount: Number(r.ITEM_COUNT),
      breakdown: breakdowns.get(r.ID) ?? {},
      createdAt: r.CREATED_AT?.toISOString?.() ?? String(r.CREATED_AT),
      updatedAt: r.UPDATED_AT?.toISOString?.() ?? String(r.UPDATED_AT),
    }));
  });
}

/** Create a collection. Throws on duplicate name (unique index ORA-00001). */
export async function createCollection(
  cfg: CorpusConfig,
  input: { name: string; description?: string; tags?: string[] },
): Promise<CollectionSummary> {
  const id = newId();
  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `INSERT INTO collections (id, name, description, tags, metadata)
       VALUES (:id, :name, :description, :tags, :metadata)`,
      {
        id,
        name: input.name.slice(0, 256),
        description: input.description?.slice(0, 2000) ?? null,
        tags: JSON.stringify(input.tags ?? []),
        metadata: JSON.stringify({}),
      },
      { autoCommit: true },
    );
  });
  return {
    id,
    name: input.name,
    description: input.description ?? null,
    tags: input.tags ?? [],
    itemCount: 0,
    breakdown: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Fetch a single collection + its files. Returns null if not found. */
export async function getCollection(
  cfg: CorpusConfig,
  id: string,
): Promise<CollectionDetail | null> {
  return withConnection(cfg, async (conn) => {
    const head = await conn.execute<{
      ID: string;
      NAME: string;
      DESCRIPTION: string | null;
      TAGS: unknown;
      CREATED_AT: Date;
      UPDATED_AT: Date;
    }>(
      `SELECT id, name, description, tags, created_at, updated_at
         FROM collections WHERE id = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const c = head.rows?.[0];
    if (!c) return null;

    const fileRows = await conn.execute<{
      ID: string;
      KIND: string;
      TITLE: string;
      MIME_TYPE: string | null;
      SIZE_BYTES: number | null;
      CREATED_AT: Date;
    }>(
      `SELECT id, kind, title, mime_type, size_bytes, created_at
         FROM artifacts
        WHERE collection_id = :id
        ORDER BY created_at DESC`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const files: CollectionFile[] = (fileRows.rows ?? []).map((r) => ({
      id: r.ID,
      kind: r.KIND,
      title: r.TITLE,
      mimeType: r.MIME_TYPE,
      sizeBytes: r.SIZE_BYTES != null ? Number(r.SIZE_BYTES) : null,
      createdAt: r.CREATED_AT?.toISOString?.() ?? String(r.CREATED_AT),
    }));
    const breakdown: Record<string, number> = {};
    for (const f of files) breakdown[f.kind] = (breakdown[f.kind] ?? 0) + 1;

    return {
      id: c.ID,
      name: c.NAME,
      description: c.DESCRIPTION,
      tags: parseTags(c.TAGS),
      itemCount: files.length,
      breakdown,
      createdAt: c.CREATED_AT?.toISOString?.() ?? String(c.CREATED_AT),
      updatedAt: c.UPDATED_AT?.toISOString?.() ?? String(c.UPDATED_AT),
      files,
    };
  });
}

/** Update name/description/tags. Returns false if the row doesn't exist. */
export async function updateCollection(
  cfg: CorpusConfig,
  id: string,
  patch: { name?: string; description?: string; tags?: string[] },
): Promise<boolean> {
  const sets: string[] = [];
  const binds: Record<string, unknown> = { id };
  if (typeof patch.name === 'string') {
    sets.push('name = :name');
    binds['name'] = patch.name.slice(0, 256);
  }
  if (typeof patch.description === 'string') {
    sets.push('description = :description');
    binds['description'] = patch.description.slice(0, 2000);
  }
  if (Array.isArray(patch.tags)) {
    sets.push('tags = :tags');
    binds['tags'] = JSON.stringify(patch.tags.map((t) => String(t)));
  }
  if (sets.length === 0) return true;
  sets.push('updated_at = SYSTIMESTAMP');

  return withConnection(cfg, async (conn) => {
    const r = await conn.execute(
      `UPDATE collections SET ${sets.join(', ')} WHERE id = :id`,
      binds as oracledb.BindParameters,
      { autoCommit: true },
    );
    return (r.rowsAffected ?? 0) > 0;
  });
}

/** Delete a collection. Its artifacts demote to free-form (FK SET NULL). */
export async function deleteCollection(cfg: CorpusConfig, id: string): Promise<boolean> {
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute(
      `DELETE FROM collections WHERE id = :id`,
      { id },
      { autoCommit: true },
    );
    return (r.rowsAffected ?? 0) > 0;
  });
}

/** Assign (or clear, with null) an artifact's collection. */
export async function setArtifactCollection(
  cfg: CorpusConfig,
  artifactId: string,
  collectionId: string | null,
): Promise<boolean> {
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute(
      `UPDATE artifacts SET collection_id = :cid, updated_at = SYSTIMESTAMP WHERE id = :id`,
      { cid: collectionId, id: artifactId },
      { autoCommit: true },
    );
    return (r.rowsAffected ?? 0) > 0;
  });
}
