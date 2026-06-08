/**
 * Corpus subsystem facade.
 *
 * Single import surface for the rest of the webapp. Returns null-shaped
 * results when the subsystem is disabled (no env config) so route handlers
 * can render a friendly "not configured" state instead of crashing.
 */

export { getCorpusConfig } from './config.js';
export type { CorpusConfig, EmbeddingProvider, ChatProvider } from './config.js';

export { dbHealthCheck, withConnection, closeDbPool } from './oci/db.js';
export {
  storageHealthCheck,
  putObject,
  createReadPar,
  deleteObject,
  getObjectBuffer,
} from './oci/storage.js';
export { genaiHealthCheck, embedTexts, chatCohere } from './oci/genai.js';
export type {
  EmbedInputType,
  CohereChatTurn,
  CohereChatDocument,
  CohereChatCitation,
  CohereChatOutcome,
} from './oci/genai.js';

export {
  speechHealthCheck,
  submitTranscriptionJob,
  getTranscriptionJob,
  cancelTranscriptionJob,
  fetchTranscriptText,
} from './oci/speech.js';
export type {
  TranscriptionJobStatus,
  TranscriptionJobView,
} from './oci/speech.js';

export {
  enqueueTranscription,
  retryTranscription,
  refetchTranscription,
  reconcileOnce,
  startTranscriptionPoller,
} from './transcribe.js';
export type { TranscriptionStatus } from './transcribe.js';

export { searchCorpus } from './search.js';
export type {
  SearchOptions,
  SearchResult,
  SearchHit,
  SearchSnippet,
} from './search.js';

export { chatCorpus, chatCorpusStream } from './chat.js';
export {
  getChatPersist,
  setChatPersist,
  getChatThread,
  saveChatThread,
  deleteChatThread,
} from './chat-history.js';
export type {
  ChatTurn,
  ChatOptions,
  ChatResult,
  ChatSource,
  ChatCitationSpan,
} from './chat.js';

import { getCorpusConfig } from './config.js';
import { dbHealthCheck } from './oci/db.js';
import { storageHealthCheck } from './oci/storage.js';
import { genaiHealthCheck } from './oci/genai.js';
import { speechHealthCheck } from './oci/speech.js';

export interface CorpusHealth {
  enabled: boolean;
  region?: string;
  bucket?: string;
  db: { ok: boolean; version?: string; user?: string; error?: string };
  storage: { ok: boolean; bucket?: string; approxObjectCount?: number; error?: string };
  genai: { ok: boolean; model?: string; dimensions?: number; error?: string };
  /** RAG chat is gated on a separate provider config. */
  chat: { enabled: boolean; provider?: string; model?: string };
  /**
   * M7 — OCI Speech / transcription. Enabled when `OCI_SPEECH_ENABLED`
   * is not set to a falsy value AND the Speech service responded to a
   * listTranscriptionJobs probe. `ok` can be false with `enabled: true`
   * if the Speech region is mis-configured or IAM is missing.
   */
  transcription: {
    enabled: boolean;
    ok?: boolean;
    region?: string;
    language?: string;
    error?: string;
  };
}

/**
 * End-to-end smoke test of all OCI services. Runs the checks in parallel —
 * if the user's network or IAM is broken we still get a full picture in
 * one round-trip.
 */
export async function corpusHealth(): Promise<CorpusHealth> {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    return {
      enabled: false,
      db: { ok: false, error: 'corpus disabled (env vars missing)' },
      storage: { ok: false, error: 'corpus disabled' },
      genai: { ok: false, error: 'corpus disabled' },
      chat: { enabled: false },
      transcription: { enabled: false },
    };
  }
  const [db, storage, genai, speech] = await Promise.all([
    dbHealthCheck(cfg),
    storageHealthCheck(cfg),
    genaiHealthCheck(cfg),
    // Don't probe Speech if the user explicitly disabled it — saves an
    // IAM round-trip and keeps /api/corpus/health fast.
    cfg.speechEnabled
      ? speechHealthCheck(cfg)
      : Promise.resolve({
          ok: false,
          region: undefined as string | undefined,
          language: undefined as string | undefined,
          error: 'OCI_SPEECH_ENABLED=false',
        }),
  ]);
  return {
    enabled: true,
    region: cfg.ociRegion,
    bucket: cfg.ociBucket,
    db,
    storage,
    genai,
    chat: cfg.chatProvider !== 'disabled'
      ? {
          enabled: true,
          provider: cfg.chatProvider,
          model: cfg.chatProvider === 'gemini'
            ? cfg.geminiModel
            : cfg.ociGenAiChatModel,
        }
      : { enabled: false },
    transcription: {
      enabled: cfg.speechEnabled,
      ok: speech.ok,
      region: speech.region ?? cfg.speechRegion,
      language: speech.language ?? cfg.speechLanguage,
      error: speech.error,
    },
  };
}
