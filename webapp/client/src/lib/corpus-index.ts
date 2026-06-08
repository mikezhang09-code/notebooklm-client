/**
 * Client for the corpus search-index status + backfill (Diagnose → Search
 * index panel). Wraps GET /api/corpus/index-status, GET /api/corpus/unchunked,
 * and the SSE POST /api/corpus/reembed.
 */
import { apiGet, streamSse } from './api';

export interface IndexStatus {
  total: number;
  chunked: number;
  /** 0-chunk artifacts backfill can index (text docs, PDFs, images). */
  fixable: number;
  /** 0-chunk audio/video awaiting transcription — not backfillable here. */
  media: number;
  provider: string;
}

export interface UnchunkedItem {
  id: string;
  title: string;
  kind: string;
  mimeType: string | null;
  createdAt: string | null;
}

export async function getIndexStatus(): Promise<IndexStatus> {
  return apiGet<IndexStatus>('/api/corpus/index-status');
}

export async function listUnchunked(): Promise<{ fixable: UnchunkedItem[]; media: UnchunkedItem[] }> {
  return apiGet<{ fixable: UnchunkedItem[]; media: UnchunkedItem[] }>('/api/corpus/unchunked');
}

/** One streamed per-document progress event from the backfill. */
export interface ReembedProgress {
  status: string;
  message: string;
  index: number;
  total: number;
  artifactId: string;
  chunks: number;
  viaOcr: boolean;
}

export interface ReembedResult {
  tally: Record<string, number>;
  processed: number;
  total: number;
}

/**
 * Run a backfill over the un-chunked artifacts, streaming progress. Pass
 * `ids` to target specific artifacts, or omit to process every fixable one.
 */
export async function backfillIndex(
  opts: {
    ids?: string[];
    onProgress?: (p: ReembedProgress) => void;
    onResult?: (r: ReembedResult) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  if (opts.ids && opts.ids.length) form.append('ids', JSON.stringify(opts.ids));
  await streamSse(
    '/api/corpus/reembed',
    form,
    {
      onProgress: (p) => opts.onProgress?.(p as unknown as ReembedProgress),
      onResult: (d) => opts.onResult?.(d as ReembedResult),
      onError: (m) => opts.onError?.(m),
    },
    signal,
  );
}
