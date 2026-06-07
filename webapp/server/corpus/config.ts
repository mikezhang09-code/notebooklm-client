/**
 * Corpus configuration loader.
 *
 * Reads OCI + Oracle DB credentials from environment variables. If any
 * critical value is missing, returns null — the corpus subsystem then
 * disables itself and the rest of the webapp continues to work as before.
 *
 * The .env file is loaded lazily (only when this module is first imported)
 * via `dotenv` if available, falling back to plain `process.env` otherwise.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type EmbeddingProvider = 'oci' | 'database' | 'gemini' | 'voyage';
export type ChatProvider = 'oci' | 'gemini' | 'mimo' | 'disabled';

export interface CorpusConfig {
  /** OCI fundamentals */
  ociConfigFile: string;
  ociProfile: string;
  ociRegion: string;
  ociCompartmentId: string;
  /** Object Storage */
  ociNamespace: string;
  ociBucket: string;
  /** Generative AI */
  ociGenAiModel: string;
  /**
   * Region to call OCI Generative AI against. Defaults to `ociRegion` but
   * many OCI regions (e.g. ap-tokyo-1) do not host Generative AI; in those
   * tenancies point this at the nearest region that does (e.g. ap-osaka-1).
   * See https://docs.oracle.com/en-us/iaas/Content/generative-ai/regions.htm
   */
  ociGenAiRegion: string;
  /**
   * Optional chat model for RAG answers (e.g. `cohere.command-r-plus-08-2024`,
   * `cohere.command-r-08-2024`). If left unset the /corpus/chat feature is
   * disabled and the rest of the corpus subsystem (embeddings, search, ingest)
   * still works as before.
   */
  ociGenAiChatModel?: string;
  /** Oracle Autonomous Database */
  oracleUser: string;
  oraclePassword: string;
  oracleConnectString: string;
  oracleWalletDir: string;
  /** Wallet password set when downloading from OCI Console. */
  oracleWalletPassword: string;

  // ── Embedding provider ──────────────────────────────────────────────────
  /**
   * Where to generate text embeddings.
   *   'oci'      — OCI GenAI REST API (cohere.embed-multilingual-v3.0) — billed per token
   *   'database' — in-database ONNX model via VECTOR_EMBEDDING() SQL — free
   *   'gemini'   — Google Gemini gemini-embedding-2 — free tier
   * Default: 'oci' (backward-compatible).
   */
  embeddingProvider: EmbeddingProvider;
  /**
   * Name of the ONNX model loaded into Oracle ADB via
   * DBMS_VECTOR.LOAD_ONNX_MODEL_CLOUD. Only used when embeddingProvider='database'.
   * Example: 'BGE_M3_MODEL'
   */
  dbEmbedModel?: string;
  /**
   * Name of the Gemini embedding model (e.g. 'gemini-embedding-2').
   * Used when embeddingProvider='gemini'.
   */
  geminiEmbedModel?: string;
  /** Voyage AI API key. Required when embeddingProvider='voyage'. */
  voyageApiKey?: string;
  /**
   * Voyage embedding model. Default 'voyage-4' — the voyage-4 family currently
   * carries the 200M-token free tier (the voyage-3.x models have 0 free quota).
   * Options: 'voyage-4' (balanced), 'voyage-4-large' (best quality),
   * 'voyage-4-lite' (fastest/cheapest). All output 1024-dim by default.
   */
  voyageModel: string;
  /**
   * Voyage output dimension (default 1024). Must match the DB VECTOR column
   * dimension — changing it requires re-creating the column + re-embedding.
   */
  voyageEmbedDim: number;

  // ── Chat provider ───────────────────────────────────────────────────────
  /**
   * Primary chat provider — the first entry of `chatProviderChain` (or
   * 'disabled' when the chain is empty). Kept as a convenience field; callers
   * that want automatic failover should use `chatProviderChain`.
   */
  chatProvider: ChatProvider;
  /**
   * Ordered list of chat providers to try, with automatic failover: the RAG
   * chat attempts each in turn and uses the first that succeeds. Gemini is
   * always first; fallbacks come from CHAT_FALLBACK_PROVIDERS (default 'mimo').
   * Only providers with valid credentials are included. Empty = chat disabled.
   */
  chatProviderChain: ChatProvider[];
  /** Google Gemini API key. Required when chatProvider='gemini'. */
  geminiApiKey?: string;
  /**
   * Gemini model identifier. Default: 'gemini-2.0-flash'.
   * Other options: 'gemini-2.5-flash', 'gemini-1.5-pro', etc.
   */
  geminiModel: string;

  /** Xiaomi Mimo API key. Required when chatProvider='mimo'. */
  mimoApiKey?: string;
  /** Xiaomi Mimo Base URL. Default: 'https://token-plan-sgp.xiaomimimo.com/v1'. */
  mimoBaseUrl: string;
  /** Xiaomi Mimo model identifier. Default: 'gpt-4o-mini' or whatever they map it to. Let's use generic default or let user override. */
  mimoModel: string;

  /**
   * M7 — OCI Speech (Whisper model) for audio/video transcription.
   *
   * All fields are optional. When `speechEnabled` is false, audio/video
   * ingest still stores the blob + catalog row but skips transcription,
   * and the transcription poller is never started. This keeps the
   * corpus subsystem fully functional even without Speech access.
   */
  speechEnabled: boolean;
  /**
   * Region to call OCI Speech against. Defaults to `ociGenAiRegion` which
   * already handles the "home region doesn't host this service" case.
   */
  speechRegion: string;
  /**
   * Whisper language code. Defaults to `auto` (lets Whisper detect).
   * Common overrides: `zh`, `en`, `ja`. See TranscriptionModelDetails
   * in oci-aispeech for the full list.
   */
  speechLanguage: string;
  /**
   * Object Storage prefix (within `ociBucket`) for transcription job output.
   * Each job writes its JSON under `<prefix><objectName>.json`.
   */
  speechOutputPrefix: string;
  /**
   * Skip files whose duration (as reported by the job after submit) exceeds
   * this cap. Defensive default of 120 minutes — a 2h MP4 already costs
   * $1 and is almost certainly not what you meant to transcribe.
   */
  maxTranscribeMinutes: number;
  /** Poller tick interval (ms). 30 s is gentle on IAM quota and the DB. */
  transcribePollMs: number;
}

let cached: CorpusConfig | null | undefined;
let loadAttempted = false;

/**
 * Best-effort .env loader. Tries `<repo-root>/.env` then `<webapp>/.env`.
 * Silently skipped if `dotenv` is not installed.
 */
async function tryLoadDotenv(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const dotenv = await import('dotenv');
    // Look in a few sensible places relative to cwd.
    const candidates = [
      resolve(process.cwd(), '.env'),
      resolve(process.cwd(), '..', '.env'),
      resolve(process.cwd(), '.env.local'),
    ];
    for (const path of candidates) {
      if (existsSync(path)) {
        dotenv.config({ path });
        // Don't break — let later files override earlier ones for predictable layering.
      }
    }
  } catch {
    // dotenv not installed; rely on process.env directly.
  }
}

function envOrNull(key: string): string | null {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Returns the corpus config, or null if the subsystem is disabled
 * (any required env var missing). Result is memoised after first call.
 */
export async function getCorpusConfig(): Promise<CorpusConfig | null> {
  if (cached !== undefined) return cached;
  await tryLoadDotenv();

  const required: Array<[keyof CorpusConfig, string]> = [
    ['ociConfigFile', 'OCI_CONFIG_FILE'],
    ['ociProfile', 'OCI_PROFILE'],
    ['ociRegion', 'OCI_REGION'],
    ['ociCompartmentId', 'OCI_COMPARTMENT_OCID'],
    ['ociNamespace', 'OCI_NAMESPACE'],
    ['ociBucket', 'OCI_BUCKET'],
    ['ociGenAiModel', 'OCI_GENAI_MODEL'],
    ['oracleUser', 'ORACLE_USER'],
    ['oraclePassword', 'ORACLE_PASSWORD'],
    ['oracleConnectString', 'ORACLE_CONNECT_STRING'],
    ['oracleWalletDir', 'ORACLE_WALLET_DIR'],
    ['oracleWalletPassword', 'ORACLE_WALLET_PASSWORD'],
  ];

  const partial: Partial<CorpusConfig> = {};
  const missing: string[] = [];
  for (const [field, envKey] of required) {
    const value = envOrNull(envKey);
    if (!value) {
      missing.push(envKey);
      continue;
    }
    (partial as Record<string, string>)[field] = value;
  }

  if (missing.length > 0) {
    console.log(
      `[corpus] disabled — missing env vars: ${missing.join(', ')}. ` +
        `Set them in .env to enable Oracle ADB + Object Storage integration.`,
    );
    cached = null;
    return cached;
  }

  // Optional: GenAI region override (falls back to ociRegion).
  (partial as CorpusConfig).ociGenAiRegion =
    envOrNull('OCI_GENAI_REGION') ?? (partial as CorpusConfig).ociRegion;
  // Optional: chat model. Leaving this unset disables /corpus/chat but keeps
  // the rest of the corpus subsystem running.
  const chatModel = envOrNull('OCI_GENAI_CHAT_MODEL');
  if (chatModel) (partial as CorpusConfig).ociGenAiChatModel = chatModel;

  // ── Embedding provider ────────────────────────────────────────────────
  const embProvRaw = envOrNull('EMBEDDING_PROVIDER');
  const embProv: EmbeddingProvider =
    embProvRaw === 'database'
      ? 'database'
      : embProvRaw === 'gemini'
        ? 'gemini'
        : embProvRaw === 'voyage'
          ? 'voyage'
          : 'oci';
  (partial as CorpusConfig).embeddingProvider = embProv;
  if (embProv === 'database') {
    const dbModel = envOrNull('DB_EMBED_MODEL');
    if (dbModel) (partial as CorpusConfig).dbEmbedModel = dbModel;
  }
  if (embProv === 'gemini') {
    (partial as CorpusConfig).geminiEmbedModel =
      envOrNull('GEMINI_EMBED_MODEL') ?? 'gemini-embedding-2';
  }
  // Voyage AI — generous free tier; 1024-dim by default.
  (partial as CorpusConfig).voyageApiKey = envOrNull('VOYAGE_API_KEY') ?? undefined;
  (partial as CorpusConfig).voyageModel = envOrNull('VOYAGE_MODEL') ?? 'voyage-4';
  const voyDimRaw = envOrNull('VOYAGE_EMBED_DIM');
  const voyDim = voyDimRaw ? parseInt(voyDimRaw, 10) : NaN;
  (partial as CorpusConfig).voyageEmbedDim = Number.isFinite(voyDim) && voyDim > 0 ? voyDim : 1024;


  // ── Chat provider chain ───────────────────────────────────────────────
  // Gemini is ALWAYS the first choice; other providers act as fallbacks,
  // tried in order if the primary fails. The fallback list is configurable
  // via CHAT_FALLBACK_PROVIDERS (comma-separated, default "mimo") so future
  // models can be slotted in without code changes. CHAT_PROVIDER=disabled
  // turns chat off entirely.
  const gemKey = envOrNull('GEMINI_API_KEY');
  if (gemKey) (partial as CorpusConfig).geminiApiKey = gemKey;
  (partial as CorpusConfig).geminiModel = envOrNull('GEMINI_MODEL') ?? 'gemini-2.0-flash';

  // Mimo credentials are always loaded so it can serve as a fallback even
  // while Gemini is primary.
  (partial as CorpusConfig).mimoApiKey = envOrNull('MIMO_API_KEY') ?? undefined;
  (partial as CorpusConfig).mimoBaseUrl =
    envOrNull('MIMO_BASE_URL') ?? 'https://token-plan-sgp.xiaomimimo.com/v1';
  (partial as CorpusConfig).mimoModel = envOrNull('MIMO_MODEL') ?? 'gpt-4o';

  // Which providers actually have credentials configured?
  const hasCreds: Record<ChatProvider, boolean> = {
    gemini: Boolean(gemKey),
    mimo: Boolean((partial as CorpusConfig).mimoApiKey),
    oci: Boolean(chatModel),
    disabled: false,
  };

  let chatChain: ChatProvider[];
  if (envOrNull('CHAT_PROVIDER') === 'disabled') {
    chatChain = [];
  } else {
    const fallbacks = (envOrNull('CHAT_FALLBACK_PROVIDERS') ?? 'mimo')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const valid = new Set<ChatProvider>(['gemini', 'mimo', 'oci']);
    // Gemini always leads, then configured fallbacks; dedup, then keep only
    // providers that are valid AND have credentials.
    chatChain = [...new Set<string>(['gemini', ...fallbacks])]
      .filter((p): p is ChatProvider => valid.has(p as ChatProvider))
      .filter((p) => hasCreds[p]);
  }
  (partial as CorpusConfig).chatProviderChain = chatChain;
  (partial as CorpusConfig).chatProvider = chatChain[0] ?? 'disabled';

  // Optional: OCI Speech (M7). Fully gated — disabling leaves the rest of
  // the corpus stack functional; audio/video ingests just skip transcription.
  const speechEnabledRaw = envOrNull('OCI_SPEECH_ENABLED');
  // Default: ON when the rest of the corpus is enabled (GenAI region is
  // typically where Speech lives too). User can force OFF with `false`/`0`.
  const speechEnabled =
    speechEnabledRaw == null
      ? true
      : !/^(false|0|no|off)$/i.test(speechEnabledRaw.trim());
  (partial as CorpusConfig).speechEnabled = speechEnabled;
  (partial as CorpusConfig).speechRegion =
    envOrNull('OCI_SPEECH_REGION') ?? (partial as CorpusConfig).ociGenAiRegion;
  (partial as CorpusConfig).speechLanguage =
    envOrNull('OCI_SPEECH_LANGUAGE') ?? 'auto';
  // Output prefix — trailing slash is optional; we always store normalised form.
  const prefixRaw = envOrNull('OCI_SPEECH_OUTPUT_PREFIX') ?? 'transcripts/';
  (partial as CorpusConfig).speechOutputPrefix = prefixRaw.endsWith('/')
    ? prefixRaw
    : `${prefixRaw}/`;
  const maxMinsRaw = envOrNull('CORPUS_MAX_TRANSCRIBE_MINUTES');
  const maxMins = maxMinsRaw ? parseInt(maxMinsRaw, 10) : NaN;
  (partial as CorpusConfig).maxTranscribeMinutes =
    Number.isFinite(maxMins) && maxMins > 0 ? maxMins : 120;
  const pollRaw = envOrNull('CORPUS_TRANSCRIBE_POLL_MS');
  const pollMs = pollRaw ? parseInt(pollRaw, 10) : NaN;
  (partial as CorpusConfig).transcribePollMs =
    Number.isFinite(pollMs) && pollMs >= 5000 ? pollMs : 30000;

  cached = partial as CorpusConfig;
  console.log(
    `[corpus] enabled — region=${cached.ociRegion} bucket=${cached.ociBucket} ` +
      `db=${cached.oracleConnectString}` +
      ` embed=${cached.embeddingProvider}` +
      (cached.embeddingProvider === 'database'
        ? `(${cached.dbEmbedModel ?? 'BGE_M3_MODEL'})`
        : cached.embeddingProvider === 'gemini'
          ? `(${cached.geminiEmbedModel})`
          : cached.embeddingProvider === 'voyage'
            ? `(${cached.voyageModel}/${cached.voyageEmbedDim}d)`
            : `(${cached.ociGenAiModel})`) +
      ` chat=[${cached.chatProviderChain.join(' → ') || 'disabled'}]` +
      (cached.chatProviderChain.includes('gemini') ? `(gemini:${cached.geminiModel})` : '') +
      (cached.speechEnabled
        ? ` speech=${cached.speechRegion}(lang=${cached.speechLanguage})`
        : ' speech=disabled'),
  );

  // Loud warning when Speech is pointed at a region the bucket doesn't
  // live in. Object Storage is a *regional* service — a Speech job
  // running in region A cannot read objects in region B, and the
  // resulting failure (INPUT_LIST_READ_ERROR) is cryptic enough that
  // we burned ~2h debugging it once. Cheap to print, invaluable to see.
  if (cached.speechEnabled && cached.speechRegion !== cached.ociRegion) {
    console.warn(
      `[corpus] ⚠️  OCI_SPEECH_REGION (${cached.speechRegion}) ≠ bucket region (${cached.ociRegion}). ` +
        `Object Storage is regional: Speech jobs in ${cached.speechRegion} cannot read a ` +
        `bucket in ${cached.ociRegion} and will fail at submit time with INPUT_LIST_READ_ERROR. ` +
        `Either set OCI_SPEECH_REGION=${cached.ociRegion}, move the bucket, or confirm cross-region replication.`,
    );
  }

  return cached;
}

/** Force a reload (for tests). */
export function _resetCorpusConfigForTests(): void {
  cached = undefined;
  loadAttempted = false;
}
