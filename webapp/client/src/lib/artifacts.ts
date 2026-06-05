/** Client for the corpus artifacts aggregation (GET /api/corpus/artifacts). */
import { apiGet, apiJson, apiDelete } from './api';
import { kindToTypeKey } from './collections';
import type { TypeKey } from './registry';

export type Provenance = 'notebooklm' | 'personal' | 'standalone';

export interface Item {
  id: string;
  kind: string;
  typeKey: TypeKey;
  provenance: Provenance;
  title: string;
  /** Originating notebook/collection name, or null for free-form. */
  from: string | null;
  sizeBytes: number | null;
  createdAt: string;
  chunkCount: number;
  tags: string[];
}

interface RawRow {
  ID: string;
  KIND: string;
  CATEGORY: string;
  ORIGIN: string;
  TITLE: string;
  NOTEBOOK_ID: string | null;
  COLLECTION_ID: string | null;
  COLLECTION_NAME: string | null;
  SIZE_BYTES: number | null;
  CREATED_AT: string;
  CHUNK_COUNT: number;
  TAGS: unknown;
  METADATA: unknown;
}

function provenanceOf(category: string): Provenance {
  if (category === 'notebooklm') return 'notebooklm';
  if (category === 'collection') return 'personal';
  return 'standalone';
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalize(r: RawRow): Item {
  const meta = parseJson<Record<string, unknown>>(r.METADATA, {});
  const prov = provenanceOf(r.CATEGORY);
  const from =
    prov === 'personal'
      ? r.COLLECTION_NAME
      : prov === 'notebooklm'
        ? (typeof meta['notebookTitle'] === 'string' && meta['notebookTitle']) || r.NOTEBOOK_ID
        : null;
  return {
    id: r.ID,
    kind: r.KIND,
    typeKey: kindToTypeKey(r.KIND) as TypeKey,
    provenance: prov,
    title: r.TITLE,
    from: from ?? null,
    sizeBytes: r.SIZE_BYTES != null ? Number(r.SIZE_BYTES) : null,
    createdAt: r.CREATED_AT,
    chunkCount: Number(r.CHUNK_COUNT ?? 0),
    tags: parseJson<string[]>(r.TAGS, []),
  };
}

export async function listItems(params?: {
  kind?: string;
  category?: string;
  limit?: number;
}): Promise<{ items: Item[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set('kind', params.kind);
  if (params?.category) qs.set('category', params.category);
  qs.set('limit', String(params?.limit ?? 200));
  const res = await apiGet<{ items: RawRow[]; total: number }>(
    `/api/corpus/artifacts?${qs.toString()}`,
  );
  return { items: (res.items ?? []).map(normalize), total: res.total };
}

/** Fetch a fresh ~1h PAR download URL for an artifact. */
export async function getDownloadUrl(id: string): Promise<string | undefined> {
  const r = await apiGet<{ downloadUrl?: string }>(`/api/corpus/artifacts/${id}`);
  return r.downloadUrl;
}

export function deleteItem(id: string): Promise<{ ok: boolean }> {
  return apiDelete(`/api/corpus/artifacts/${id}`);
}

/** Returns a long-lived share URL (server shape: { shareUrl } or { url }). */
export async function shareItem(id: string): Promise<string> {
  const r = await apiJson<{ shareUrl?: string; url?: string; downloadUrl?: string }>(
    `/api/corpus/artifacts/${id}/share`,
    {},
  );
  return r.shareUrl ?? r.url ?? r.downloadUrl ?? '';
}
