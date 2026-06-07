/** Client for the corpus artifacts aggregation (GET /api/corpus/artifacts). */
import { apiGet, apiJson, apiDelete } from './api';
import { typeKeyFor } from './registry';
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
  /** Source NotebookLM artifact id (for matching saved notebook artifacts). */
  artifactId: string | null;
  notebookId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  chunkCount: number;
  tags: string[];
  /** Free-text description (stored in metadata.description), or null. */
  description: string | null;
}

interface RawRow {
  ID: string;
  KIND: string;
  CATEGORY: string;
  ORIGIN: string;
  TITLE: string;
  NOTEBOOK_ID: string | null;
  ARTIFACT_ID: string | null;
  COLLECTION_ID: string | null;
  COLLECTION_NAME: string | null;
  MIME_TYPE: string | null;
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
    typeKey: typeKeyFor(r.KIND, r.MIME_TYPE, r.TITLE),
    provenance: prov,
    title: r.TITLE,
    from: from ?? null,
    artifactId: r.ARTIFACT_ID ?? null,
    notebookId: r.NOTEBOOK_ID ?? null,
    mimeType: r.MIME_TYPE ?? null,
    sizeBytes: r.SIZE_BYTES != null ? Number(r.SIZE_BYTES) : null,
    createdAt: r.CREATED_AT,
    chunkCount: Number(r.CHUNK_COUNT ?? 0),
    tags: parseJson<string[]>(r.TAGS, []),
    description: typeof meta['description'] === 'string' ? (meta['description'] as string) : null,
  };
}

export async function listItems(params?: {
  kind?: string;
  category?: string;
  notebookId?: string;
  limit?: number;
}): Promise<{ items: Item[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set('kind', params.kind);
  if (params?.category) qs.set('category', params.category);
  if (params?.notebookId) qs.set('notebookId', params.notebookId);
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

/** A node in a NotebookLM mind-map tree. */
export interface MindNode {
  name: string;
  children: MindNode[];
}

export type ViewPayload =
  | { type: 'pdf'; downloadUrl: string; mimeType?: string }
  | { type: 'office'; officeViewerUrl: string; downloadUrl: string; mimeType?: string }
  | { type: 'image'; downloadUrl: string; mimeType?: string }
  | { type: 'html'; content: string; downloadUrl: string; mimeType?: string }
  | { type: 'text'; content: string; downloadUrl: string; mimeType?: string }
  | { type: 'mindmap'; tree: MindNode; downloadUrl: string; mimeType?: string }
  | { type: 'unsupported'; downloadUrl: string; mimeType?: string };

/** Fetch inline-render info for an artifact (pdf/office/image/html/text/unsupported). */
export function getView(id: string): Promise<ViewPayload> {
  return apiGet<ViewPayload>(`/api/corpus/artifacts/${id}/view`);
}

/** Raw UTF-8 text of a text artifact (for the editor). */
export function getRawText(id: string): Promise<{ content: string; mimeType: string | null }> {
  return apiGet(`/api/corpus/artifacts/${id}/raw`);
}

/** Replace a text artifact's content (re-embeds server-side). */
export function updateArtifactContent(
  id: string,
  input: { markdown: string; title?: string },
): Promise<{ id: string; chunkCount: number; embedSkipped?: boolean }> {
  return apiJson(`/api/corpus/artifacts/${id}/content`, input, 'PUT');
}

/** Whether an item is editable in the markdown editor (not a NotebookLM doc). */
export function isEditable(item: Item): boolean {
  if (item.provenance === 'notebooklm') return false;
  const m = (item.mimeType ?? '').toLowerCase();
  return item.kind === 'note' || m.includes('markdown') || m === 'text/plain';
}

export function deleteItem(id: string): Promise<{ ok: boolean }> {
  return apiDelete(`/api/corpus/artifacts/${id}`);
}

export interface ArtifactEditState {
  title: string;
  kind: string;
  description: string;
  tags: string[];
}

/** Fetch the editable fields of an artifact (title/kind/description/tags). */
export async function getArtifactEdit(id: string): Promise<ArtifactEditState> {
  const r = await apiGet<{ artifact: Record<string, unknown> }>(`/api/corpus/artifacts/${id}`);
  const a = r.artifact ?? {};
  const meta = parseJson<Record<string, unknown>>(a['METADATA'], {});
  return {
    title: typeof a['TITLE'] === 'string' ? a['TITLE'] : '',
    kind: typeof a['KIND'] === 'string' ? a['KIND'] : 'upload',
    description: typeof meta['description'] === 'string' ? (meta['description'] as string) : '',
    tags: parseJson<string[]>(a['TAGS'], []),
  };
}

/** Update an artifact's editable fields. Omitted fields are left unchanged. */
export function updateArtifact(
  id: string,
  patch: { title?: string; kind?: string; description?: string; tags?: string[] },
): Promise<{ ok: boolean; id: string }> {
  return apiJson(`/api/corpus/artifacts/${id}`, patch, 'PATCH');
}

/** Save a generated job file into the corpus (free-form, or into a collection). */
export function saveFromJob(input: {
  jobId: string;
  filename: string;
  kind: string;
  title: string;
  origin?: 'upload' | 'notebooklm';
  collectionId?: string;
}): Promise<{ id: string; embedSkipped?: boolean }> {
  return apiJson('/api/corpus/save-from-job', input);
}

/** Fetch notebook id → title (for resolving the "From" column on notebooklm items). */
export async function fetchNotebookMap(): Promise<Map<string, string>> {
  try {
    const { notebooks } = await apiGet<{ notebooks: { id: string; title: string }[] }>(
      '/api/notebooks',
    );
    return new Map(notebooks.map((n) => [n.id, n.title]));
  } catch {
    return new Map();
  }
}

/** Best display value for an item's origin: prefer the live notebook name. */
export function resolveFrom(item: Item, nbMap: Map<string, string>): string | null {
  if (item.provenance === 'notebooklm' && item.notebookId) {
    return nbMap.get(item.notebookId) ?? item.from ?? item.notebookId;
  }
  return item.from;
}

/** Returns a long-lived share URL (server shape: { shareUrl } or { url }). */
export async function shareItem(id: string): Promise<string> {
  const r = await apiJson<{ shareUrl?: string; url?: string; downloadUrl?: string }>(
    `/api/corpus/artifacts/${id}/share`,
    {},
  );
  return r.shareUrl ?? r.url ?? r.downloadUrl ?? '';
}
