/**
 * Client-side typings + helpers for the /api/corpus endpoints.
 *
 * Mirrors webapp/server/corpus/{search,ingest}.ts response shapes — keep
 * them in sync when changing the API.
 */

import { apiGet, apiJson, apiFormData, apiDelete } from './api';

// ───────────────────────────────────────────────────────────── health ──

export interface CorpusHealth {
  enabled: boolean;
  region?: string;
  bucket?: string;
  db: { ok: boolean; version?: string; user?: string; error?: string };
  storage: { ok: boolean; bucket?: string; approxObjectCount?: number; error?: string };
  genai: { ok: boolean; model?: string; dimensions?: number; error?: string };
  chat: { enabled: boolean; model?: string };
}

export function getCorpusHealth(): Promise<CorpusHealth> {
  return apiGet<CorpusHealth>('/api/corpus/health');
}

// ───────────────────────────────────────────────────────────── search ──

export type ArtifactKind =
  | 'audio'
  | 'report'
  | 'video'
  | 'quiz'
  | 'flashcards'
  | 'infographic'
  | 'slides'
  | 'data_table'
  | 'upload';

export const ARTIFACT_KINDS: ArtifactKind[] = [
  'audio',
  'report',
  'video',
  'quiz',
  'flashcards',
  'infographic',
  'slides',
  'data_table',
  'upload',
];

export interface SearchOptions {
  query: string;
  kind?: ArtifactKind;
  notebookId?: string;
  candidateLimit?: number;
  artifactLimit?: number;
  snippetsPerArtifact?: number;
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
    kind: ArtifactKind | string;
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
  bestDistance: number;
  snippets: SearchSnippet[];
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  candidatesScanned: number;
  embedMs: number;
  sqlMs: number;
}

export function searchCorpus(opts: SearchOptions): Promise<SearchResult> {
  return apiJson<SearchResult>('/api/corpus/search', opts);
}

// ─────────────────────────────────────────────────────────── artifacts ──

export interface ArtifactListItem {
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
  TAGS: string[] | string | null;
  METADATA: Record<string, unknown> | string | null;
  CREATED_AT: string;
  CHUNK_COUNT: number;
}

export interface ArtifactListResponse {
  items: ArtifactListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ArtifactListQuery {
  kind?: string;
  origin?: string;
  notebookId?: string;
  limit?: number;
  offset?: number;
}

export function listArtifacts(q: ArtifactListQuery = {}): Promise<ArtifactListResponse> {
  const params = new URLSearchParams();
  if (q.kind) params.set('kind', q.kind);
  if (q.origin) params.set('origin', q.origin);
  if (q.notebookId) params.set('notebookId', q.notebookId);
  if (q.limit != null) params.set('limit', String(q.limit));
  if (q.offset != null) params.set('offset', String(q.offset));
  const qs = params.toString();
  return apiGet<ArtifactListResponse>(
    `/api/corpus/artifacts${qs ? `?${qs}` : ''}`,
  );
}

export interface ArtifactDetail {
  artifact: ArtifactListItem | unknown;
  downloadUrl: string;
  expiresAt: string;
}

export function getArtifact(id: string): Promise<ArtifactDetail> {
  return apiGet<ArtifactDetail>(`/api/corpus/artifacts/${encodeURIComponent(id)}`);
}

// ─────────────────────────────────────────────────────────── ingest ──

export interface IngestPayload {
  file: File;
  title: string;
  kind: ArtifactKind;
  origin?: 'notebooklm' | 'upload';
  notebookId?: string;
  artifactId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  id: string;
  objectName: string;
  bucket: string;
  chunkCount: number;
  textPreview: string;
  sizeBytes: number;
}

export function ingestToCorpus(payload: IngestPayload): Promise<IngestResult> {
  const fd = new FormData();
  fd.set('file', payload.file);
  fd.set('title', payload.title);
  fd.set('kind', payload.kind);
  if (payload.origin) fd.set('origin', payload.origin);
  if (payload.notebookId) fd.set('notebookId', payload.notebookId);
  if (payload.artifactId) fd.set('artifactId', payload.artifactId);
  if (payload.tags) fd.set('tags', JSON.stringify(payload.tags));
  if (payload.metadata) fd.set('metadata', JSON.stringify(payload.metadata));
  return apiFormData<IngestResult>('/api/corpus/ingest', fd);
}

// ─────────────────────────────────────────────────────────── M5 mutate ──

export interface UpdateArtifactInput {
  title?: string;
  tags?: string[];
}

export function updateArtifact(
  id: string,
  patch: UpdateArtifactInput,
): Promise<{ ok: true; id: string }> {
  return apiJson<{ ok: true; id: string }>(
    `/api/corpus/artifacts/${encodeURIComponent(id)}`,
    patch,
    'PATCH',
  );
}

export function deleteArtifact(
  id: string,
): Promise<{ deleted: boolean; blobDeleted: boolean; id: string }> {
  return apiDelete<{ deleted: boolean; blobDeleted: boolean; id: string }>(
    `/api/corpus/artifacts/${encodeURIComponent(id)}`,
  );
}

export interface ShareResult {
  shareUrl: string;
  ttlHours: number;
  expiresAt: string;
}

export function shareArtifact(
  id: string,
  ttlHours = 24,
): Promise<ShareResult> {
  return apiJson<ShareResult>(
    `/api/corpus/artifacts/${encodeURIComponent(id)}/share`,
    { ttlHours },
  );
}

// ────────────────────────────────────────────────────────────── M6 chat ──

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCitationSpan {
  start: number;
  end: number;
  text: string;
  /** 1-based indices into ChatResult.sources. */
  sourceIndices: number[];
}

export interface ChatSource {
  index: number;
  artifact: SearchHit['artifact'];
  snippets: SearchSnippet[];
  bestDistance: number;
}

export interface ChatResult {
  answer: string;
  citations: ChatCitationSpan[];
  sources: ChatSource[];
  retrievalMs: number;
  chatMs: number;
  noSources: boolean;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChatRequest {
  question: string;
  history?: ChatTurn[];
  kind?: ArtifactKind;
  notebookId?: string;
  maxSources?: number;
  snippetsPerSource?: number;
  maxDistance?: number;
}

export function chatWithCorpus(req: ChatRequest): Promise<ChatResult> {
  return apiJson<ChatResult>('/api/corpus/chat', req);
}
