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
  /** M7 — OCI Speech transcription. `ok: false` when probe failed. */
  transcription?: {
    enabled: boolean;
    ok?: boolean;
    region?: string;
    language?: string;
    error?: string;
  };
}

export type TranscriptionStatus =
  | 'pending'
  | 'transcribing'
  | 'done'
  | 'failed'
  | 'skipped';

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
  | 'upload'
  | 'qa';

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
  'qa',
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
  /** M7 — transcription tracking. Null for non-audio/video or pre-M7 rows. */
  TRANSCRIPTION_STATUS?: TranscriptionStatus | null;
  TRANSCRIPTION_JOB_OCID?: string | null;
  TRANSCRIBED_AT?: string | null;
  TRANSCRIPTION_ERROR?: string | null;
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

// ─────────────────────────────────────────────────────── M7 transcribe ──

export interface TranscribeResult {
  id: string;
  status: 'queued';
}

/**
 * Manually (re-)trigger transcription for an audio/video artifact.
 * Returns 202 with `{ status: 'queued' }`; the actual outcome lands on
 * the artifact row's TRANSCRIPTION_STATUS field shortly after.
 */
export function transcribeArtifact(id: string): Promise<TranscribeResult> {
  return apiJson<TranscribeResult>(
    `/api/corpus/artifacts/${encodeURIComponent(id)}/transcribe`,
    {},
  );
}

// ───────────────────────────────────────────────── save NotebookLM chat ──

/**
 * One turn of a NotebookLM conversation, in the shape the save endpoint
 * expects. Mirrors `SavedChatTurn` on the server.
 */
export interface SavedChatTurnPayload {
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{
    index: number;
    excerpt: string;
    sourceId: string | null;
  }>;
}

export interface SaveChatRequest {
  notebookId: string;
  notebookTitle: string;
  /** Client-minted UUID; same value across re-saves of the same thread. */
  sessionId: string;
  title: string;
  turns: SavedChatTurnPayload[];
}

export interface SaveChatResult {
  id: string;
  sessionId: string;
  chunkCount: number;
  /** True iff a new artifact row was created; false on update-in-place. */
  created: boolean;
}

/**
 * Persist a NotebookLM chat conversation to the corpus as a `kind='qa'`
 * artifact. Idempotent on `sessionId` — second call with the same
 * sessionId updates the existing artifact instead of creating a duplicate.
 */
export function saveChatToCorpus(req: SaveChatRequest): Promise<SaveChatResult> {
  return apiJson<SaveChatResult>('/api/corpus/chat/save', req);
}

// ──────────────────────────────────────────────────── artifact viewer ──

export interface ViewResult {
  type: 'pdf' | 'office' | 'html' | 'text' | 'unsupported';
  downloadUrl: string;
  expiresAt: string;
  officeViewerUrl?: string;
  content?: string;
  mimeType?: string;
}

export function viewArtifact(id: string): Promise<ViewResult> {
  return apiGet<ViewResult>(`/api/corpus/artifacts/${encodeURIComponent(id)}/view`);
}

// ──────────────────────────────────────────── save generated artifact ──

export interface SaveJobArtifactRequest {
  jobId: string;
  filename: string;
  /** Generate kind (e.g. 'report', 'data-table'). Server maps to corpus kind. */
  kind: string;
  title: string;
  notebookId?: string;
}

export interface SaveJobArtifactResult {
  id: string;
  objectName: string;
  bucket: string;
  chunkCount: number;
  textPreview: string;
  sizeBytes: number;
}

export function saveJobArtifact(req: SaveJobArtifactRequest): Promise<SaveJobArtifactResult> {
  return apiJson<SaveJobArtifactResult>('/api/corpus/save-from-job', req);
}
