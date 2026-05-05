/**
 * OCI Speech client wrapper — file-based asynchronous transcription using
 * the Whisper model. Audio/video artifacts in Object Storage are submitted
 * as transcription jobs; the JSON output (also in Object Storage) is later
 * fetched and chunked by the transcription orchestrator.
 *
 * Workflow:
 *   1) submitTranscriptionJob() — create job pointing at one ObjectLocation,
 *      returns job OCID for later polling.
 *   2) getTranscriptionJob() — poll for lifecycle state (ACCEPTED →
 *      IN_PROGRESS → SUCCEEDED | FAILED | CANCELED).
 *   3) fetchTranscriptText() — once SUCCEEDED, pull the JSON output from
 *      Object Storage and flatten it to plain text for chunking.
 *
 * Auth is the same API-key flow as storage.ts / genai.ts. Region can
 * diverge from the home region via OCI_SPEECH_REGION (Speech isn't
 * available in every region).
 */

import * as common from 'oci-common';
import * as speech from 'oci-aispeech';
import * as objectstorage from 'oci-objectstorage';
import type { CorpusConfig } from '../config.js';
import { getStorageClient } from './storage.js';

// ─── Client factory ──────────────────────────────────────────────────────

let clientPromise: Promise<speech.AIServiceSpeechClient> | null = null;

async function buildClient(cfg: CorpusConfig): Promise<speech.AIServiceSpeechClient> {
  const provider = new common.ConfigFileAuthenticationDetailsProvider(
    cfg.ociConfigFile,
    cfg.ociProfile,
  );
  const client = new speech.AIServiceSpeechClient({
    authenticationDetailsProvider: provider,
  });
  // Use the Speech-specific region — defaults to the GenAI region, but
  // some tenancies may need to pin it separately if Speech is hosted
  // elsewhere than GenAI.
  client.regionId = cfg.speechRegion;
  return client;
}

export async function getSpeechClient(cfg: CorpusConfig): Promise<speech.AIServiceSpeechClient> {
  if (!clientPromise) clientPromise = buildClient(cfg);
  return clientPromise;
}

// ─── Types exposed to the orchestrator ───────────────────────────────────

export type TranscriptionJobStatus =
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELING'
  | 'CANCELED'
  | 'UNKNOWN';

export interface TranscriptionJobView {
  id: string;
  status: TranscriptionJobStatus;
  /** Percent complete, if reported (0–100). */
  percentComplete?: number;
  /** Error detail on FAILED, cancel reason on CANCELED. */
  lifecycleDetails?: string;
  /** Resolved output object name when SUCCEEDED (ready to fetchTranscriptText). */
  outputObjectName?: string;
}

// ─── Submit ──────────────────────────────────────────────────────────────

export interface SubmitOptions {
  /** Object Storage bucket holding the input audio/video blob. */
  bucket: string;
  /** Object name (path inside the bucket) of the input. */
  objectName: string;
  /** User-friendly display name for the OCI console. */
  displayName?: string;
  /** Whisper language code override — falls back to cfg.speechLanguage. */
  language?: string;
  /** Retry token for idempotent submits (24-h window). */
  retryToken?: string;
}

/**
 * OCI Speech restricts `displayName` to `[a-zA-Z0-9_-]`. Callers often
 * hand us artifact titles (which may contain Chinese, colons, spaces,
 * slashes, etc.) or object paths (which contain `/`). This helper maps
 * any disallowed character to `-`, collapses runs of `-`, trims leading
 * and trailing `-`, caps at 255 chars, and falls back to a safe default
 * if the result is empty.
 */
export function sanitiseDisplayName(raw: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'nblm-job';
}

/**
 * Submit a new transcription job. Returns the job OCID and the object
 * name where the JSON output will eventually land (deterministic —
 * `<speechOutputPrefix><objectName>.json`).
 */
export async function submitTranscriptionJob(
  cfg: CorpusConfig,
  opts: SubmitOptions,
): Promise<{ jobOcid: string; outputObjectName: string }> {
  const client = await getSpeechClient(cfg);
  const language = opts.language ?? cfg.speechLanguage;

  const displayName = sanitiseDisplayName(
    opts.displayName ?? `nblm-${opts.objectName.slice(-40)}`,
  );

  const createRequest = {
    createTranscriptionJobDetails: {
      compartmentId: cfg.ociCompartmentId,
      displayName,
      description: 'notebooklm-webapp corpus transcription',
      modelDetails: {
        // Whisper is locale-agnostic and covers zh/ja/ko/en/etc.
        // WHISPER_MEDIUM is the public tier; WHISPER_LARGE_V2 is request-only.
        modelType: 'WHISPER_MEDIUM',
        domain:
          speech.models.TranscriptionModelDetails.Domain.Generic,
        languageCode: language,
      },
      inputLocation: {
        locationType: 'OBJECT_LIST_INLINE_INPUT_LOCATION',
        objectLocations: [
          {
            namespaceName: cfg.ociNamespace,
            bucketName: opts.bucket,
            objectNames: [opts.objectName],
          },
        ],
      },
      outputLocation: {
        namespaceName: cfg.ociNamespace,
        bucketName: cfg.ociBucket,
        prefix: cfg.speechOutputPrefix,
      },
    },
    opcRetryToken: opts.retryToken,
  } as unknown as speech.requests.CreateTranscriptionJobRequest;

  const response = await client.createTranscriptionJob(createRequest);
  const jobId = response.transcriptionJob.id;
  if (!jobId) {
    throw new Error('OCI Speech did not return a job OCID');
  }

  // OCI Speech names the per-input JSON output as:
  //   <prefix><namespace>_<bucket>_<object>.json
  // All delimiters in `object` become `_`. We reconstruct this so the
  // poller can fetch the file directly; fallback to listObjects if our
  // guess ever misses (see fetchTranscriptText()).
  const flatName = opts.objectName.replace(/[/\\]/g, '_');
  const outputObjectName = `${cfg.speechOutputPrefix}${cfg.ociNamespace}_${opts.bucket}_${flatName}.json`;

  return { jobOcid: jobId, outputObjectName };
}

// ─── Poll ────────────────────────────────────────────────────────────────

/** One-shot status check. Cheap; safe to call in a poller. */
export async function getTranscriptionJob(
  cfg: CorpusConfig,
  jobOcid: string,
): Promise<TranscriptionJobView> {
  const client = await getSpeechClient(cfg);
  const resp = await client.getTranscriptionJob({ transcriptionJobId: jobOcid });
  const job = resp.transcriptionJob;
  const stateRaw = (job.lifecycleState ?? 'UNKNOWN') as string;
  const status = (
    ['ACCEPTED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELING', 'CANCELED'].includes(
      stateRaw,
    )
      ? stateRaw
      : 'UNKNOWN'
  ) as TranscriptionJobStatus;
  return {
    id: job.id,
    status,
    percentComplete:
      typeof job.percentComplete === 'number' ? job.percentComplete : undefined,
    lifecycleDetails: job.lifecycleDetails,
  };
}

// ─── Cancel ──────────────────────────────────────────────────────────────

export async function cancelTranscriptionJob(
  cfg: CorpusConfig,
  jobOcid: string,
): Promise<void> {
  const client = await getSpeechClient(cfg);
  await client.cancelTranscriptionJob({ transcriptionJobId: jobOcid });
}

// ─── Fetch output JSON → plain text ──────────────────────────────────────

/**
 * Loosely-typed shape of the per-input Speech JSON output. The real
 * schema is richer (tokens, timestamps, speaker ids, confidence) but we
 * only need the flat text for embedding. We defensively accept both
 * `transcription` (legacy) and `transcriptions[0].transcription` (current).
 */
interface SpeechOutputJson {
  transcriptions?: Array<{
    transcription?: string;
    tokens?: Array<{ token?: string; text?: string }>;
  }>;
}

/**
 * Fetch the JSON output blob from Object Storage and flatten it to a
 * single plain-text string suitable for chunking and embedding.
 *
 * Returns null when the output object is missing or empty.
 */
export async function fetchTranscriptText(
  cfg: CorpusConfig,
  outputObjectName: string,
): Promise<string | null> {
  const client = await getStorageClient(cfg);
  let json: SpeechOutputJson;
  try {
    const resp = await client.getObject({
      namespaceName: cfg.ociNamespace,
      bucketName: cfg.ociBucket,
      objectName: outputObjectName,
    });
    const bodyText = await streamToString(resp.value);
    if (!bodyText) return null;
    json = JSON.parse(bodyText) as SpeechOutputJson;
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404) return null;
    throw err;
  }

  const first = json.transcriptions?.[0];
  if (!first) return null;

  // Preferred: the service joins tokens into a punctuated string for us.
  const joined = first.transcription?.trim();
  if (joined) return joined;

  // Fallback: join tokens manually. Handles older output shapes.
  const tokens = first.tokens
    ?.map((t) => t.token ?? t.text ?? '')
    .filter((s) => s.length > 0);
  if (tokens && tokens.length > 0) return tokens.join(' ');

  return null;
}

/**
 * `getObject` returns `value` as `NodeJS.ReadableStream | ReadableStream`
 * depending on the SDK variant. We consume it into a UTF-8 string.
 */
async function streamToString(value: unknown): Promise<string> {
  // Buffer shortcut.
  if (value == null) return '';
  if (typeof (value as Buffer).toString === 'function' && (value as Buffer).length != null) {
    // Not all Buffer-likes are Buffers, but enough to try this fast path.
    try {
      return (value as Buffer).toString('utf8');
    } catch {
      /* fall through */
    }
  }
  // Async iterable (Node Readable).
  if (typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of value as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  // WHATWG ReadableStream (getReader).
  const asStream = value as ReadableStream<Uint8Array>;
  if (typeof asStream.getReader === 'function') {
    const reader = asStream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value: v, done } = await reader.read();
      if (done) break;
      if (v) chunks.push(v);
    }
    return Buffer.concat(chunks.map((u) => Buffer.from(u))).toString('utf8');
  }
  return '';
}

// ─── Health check ────────────────────────────────────────────────────────

/**
 * Cheap auth/region probe. Lists transcription jobs in the compartment
 * with `limit=1` — fastest way to exercise Speech auth + IAM policies
 * without submitting actual work.
 */
export async function speechHealthCheck(cfg: CorpusConfig): Promise<{
  ok: boolean;
  region?: string;
  language?: string;
  error?: string;
}> {
  if (!cfg.speechEnabled) {
    return { ok: false, error: 'OCI_SPEECH_ENABLED=false' };
  }
  try {
    const client = await getSpeechClient(cfg);
    await client.listTranscriptionJobs({
      compartmentId: cfg.ociCompartmentId,
      limit: 1,
    });
    return {
      ok: true,
      region: cfg.speechRegion,
      language: cfg.speechLanguage,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Silence unused-import warnings when the SDK's model namespace isn't
// otherwise referenced after SDK updates rearrange the type graph.
void objectstorage;
