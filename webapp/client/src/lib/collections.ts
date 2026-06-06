/** Client for the collections API (GET/POST/PATCH/DELETE /api/corpus/collections). */
import { apiGet, apiJson, apiDelete } from './api';

export interface CollectionPatch {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  itemCount: number;
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

export function listCollections(): Promise<{ collections: CollectionSummary[] }> {
  return apiGet('/api/corpus/collections');
}

export function createCollection(input: {
  name: string;
  description?: string;
  tags?: string[];
}): Promise<CollectionSummary> {
  return apiJson('/api/corpus/collections', input);
}

export function getCollection(id: string): Promise<CollectionDetail> {
  return apiGet(`/api/corpus/collections/${id}`);
}

export function updateCollection(id: string, patch: CollectionPatch): Promise<{ ok: boolean }> {
  return apiJson(`/api/corpus/collections/${id}`, patch, 'PATCH');
}

export function deleteCollection(id: string): Promise<{ ok: boolean }> {
  return apiDelete(`/api/corpus/collections/${id}`);
}

/** Map a backend artifact `kind` to the UI type registry key. */
export function kindToTypeKey(kind: string): string {
  switch (kind) {
    case 'flashcards':
      return 'flash';
    case 'infographic':
      return 'info';
    case 'data_table':
      return 'table';
    case 'slides':
      return 'slides';
    case 'upload':
    case 'qa':
      return 'report';
    default:
      return kind; // audio, report, video, quiz, mind
  }
}

/** Relative "x ago" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
