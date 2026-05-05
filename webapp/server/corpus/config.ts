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
      `db=${cached.oracleConnectString} genai=${cached.ociGenAiRegion}` +
      (cached.ociGenAiChatModel ? ` chat=${cached.ociGenAiChatModel}` : ' chat=disabled') +
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
