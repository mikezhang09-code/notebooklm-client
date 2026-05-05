/**
 * Transcription orchestrator — M7.
 *
 * Responsibilities:
 *   - enqueueTranscription()     — called from ingest.ts when audio/video
 *                                  artifacts land. Marks the row pending,
 *                                  submits the OCI Speech job, flips to
 *                                  'transcribing' with the job OCID.
 *   - startTranscriptionPoller() — boots a single setInterval loop that
 *                                  reconciles pending jobs on every tick.
 *   - reconcileOnce()            — single tick: fetch all 'transcribing'
 *                                  rows, query their job status, finalise
 *                                  SUCCEEDED (chunk + embed + insert) or
 *                                  mark FAILED.
 *   - retryTranscription()       — resets a failed/skipped row and
 *                                  re-enqueues it.
 *
 * State machine (see plan §8):
 *   NULL → pending → transcribing → done | failed | skipped
 *
 * Idempotent — if the poller runs mid-flight on a restart, or two ticks
 * overlap, the UPDATE ... WHERE transcription_status='transcribing' guard
 * plus the "first-finaliser-wins" pattern keeps us safe. Concurrency is
 * capped so we don't blow up the embedding budget on a bulk-finish spike.
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import { embedTexts } from './oci/genai.js';
import {
  submitTranscriptionJob,
  getTranscriptionJob,
  fetchTranscriptText,
  type TranscriptionJobStatus,
} from './oci/speech.js';
import { chunkText } from './chunk.js';
import { newId } from './ulid.js';

// ─── Types ───────────────────────────────────────────────────────────────

export type TranscriptionStatus =
  | 'pending'
  | 'transcribing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface ArtifactForTranscription {
  id: string;
  kind: string;
  bucket: string;
  objectName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  transcriptionStatus: TranscriptionStatus | null;
  transcriptionJobOcid: string | null;
}

/** Kinds that should be transcribed. Everything else is `skipped`. */
const AUDIO_VIDEO_KINDS = new Set<string>(['audio', 'video']);

/** Max concurrent finalisations per poll tick. */
const FINALISE_CONCURRENCY = 3;

// ─── DB helpers ──────────────────────────────────────────────────────────

async function updateTranscriptionStatus(
  cfg: CorpusConfig,
  id: string,
  fields: {
    status: TranscriptionStatus;
    jobOcid?: string | null;
    error?: string | null;
    clearJob?: boolean;
  },
): Promise<void> {
  const sets: string[] = ['transcription_status = :status'];
  const binds: Record<string, unknown> = { status: fields.status, id };

  if (fields.jobOcid !== undefined) {
    sets.push('transcription_job_ocid = :job');
    binds['job'] = fields.jobOcid;
  } else if (fields.clearJob) {
    sets.push('transcription_job_ocid = NULL');
  }

  if (fields.error !== undefined) {
    sets.push('transcription_error = :err');
    binds['err'] = fields.error?.slice(0, 1999) ?? null;
  }

  if (fields.status === 'done') {
    sets.push('transcribed_at = SYSTIMESTAMP');
  }

  sets.push('updated_at = SYSTIMESTAMP');

  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `UPDATE artifacts SET ${sets.join(', ')} WHERE id = :id`,
      binds as unknown as oracledb.BindParameters,
      { autoCommit: true },
    );
  });
}

async function loadArtifact(
  cfg: CorpusConfig,
  id: string,
): Promise<ArtifactForTranscription | null> {
  interface Row {
    ID: string;
    KIND: string;
    BUCKET: string;
    OBJECT_NAME: string;
    MIME_TYPE: string | null;
    SIZE_BYTES: number | null;
    TRANSCRIPTION_STATUS: string | null;
    TRANSCRIPTION_JOB_OCID: string | null;
  }
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute<Row>(
      `SELECT id, kind, bucket, object_name, mime_type, size_bytes,
              transcription_status, transcription_job_ocid
         FROM artifacts
        WHERE id = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      id: row.ID,
      kind: row.KIND,
      bucket: row.BUCKET,
      objectName: row.OBJECT_NAME,
      mimeType: row.MIME_TYPE,
      sizeBytes: row.SIZE_BYTES,
      transcriptionStatus: (row.TRANSCRIPTION_STATUS as TranscriptionStatus | null) ?? null,
      transcriptionJobOcid: row.TRANSCRIPTION_JOB_OCID,
    };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Outcome of an enqueue attempt, so callers (backfill CLI, retry route)
 * can report honestly without re-querying the row. `transcribing` means
 * the job is live at OCI Speech; `failed` means submit errored and the
 * error is already persisted to the row's `transcription_error` column;
 * `skipped` means we deliberately did nothing (wrong kind, speech off);
 * `already_done` / `already_running` are no-op idempotency short-circuits.
 */
export type EnqueueOutcome =
  | { status: 'transcribing'; jobOcid: string }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string }
  | { status: 'already_done' }
  | { status: 'already_running'; jobOcid: string };

/**
 * Called by ingest.ts right after a successful insert of an audio/video
 * artifact. Submits the OCI Speech job and flips the row to 'transcribing'.
 *
 * Idempotent: if the row is already transcribing/done, this is a no-op.
 * On any submit failure, the row is marked 'failed' with the error message
 * *and* the error is returned in the outcome (never thrown) — ingest.ts
 * relies on this to prevent transcription errors from failing the parent
 * commit.
 */
export async function enqueueTranscription(
  cfg: CorpusConfig,
  artifactId: string,
): Promise<EnqueueOutcome> {
  if (!cfg.speechEnabled) {
    await updateTranscriptionStatus(cfg, artifactId, {
      status: 'skipped',
      error: 'OCI_SPEECH_ENABLED=false',
    });
    return { status: 'skipped', reason: 'OCI_SPEECH_ENABLED=false' };
  }

  const art = await loadArtifact(cfg, artifactId);
  if (!art) {
    throw new Error(`enqueueTranscription: artifact ${artifactId} not found`);
  }

  if (!AUDIO_VIDEO_KINDS.has(art.kind)) {
    const reason = `kind "${art.kind}" not transcribable`;
    await updateTranscriptionStatus(cfg, artifactId, {
      status: 'skipped',
      error: reason,
    });
    return { status: 'skipped', reason };
  }

  if (art.transcriptionStatus === 'done') {
    return { status: 'already_done' };
  }
  if (art.transcriptionStatus === 'transcribing' && art.transcriptionJobOcid) {
    // Already in flight — let the poller handle it.
    return {
      status: 'already_running',
      jobOcid: art.transcriptionJobOcid,
    };
  }

  try {
    const { jobOcid } = await submitTranscriptionJob(cfg, {
      bucket: art.bucket,
      objectName: art.objectName,
      // OCI Speech displayName only accepts [a-zA-Z0-9_-]. We use a
      // stable `nblm-<id>` prefix; the sanitiser in speech.ts is a
      // belt-and-braces check in case callers pass anything richer.
      displayName: `nblm-${art.id}`,
    });
    await updateTranscriptionStatus(cfg, artifactId, {
      status: 'transcribing',
      jobOcid,
      error: null,
    });
    console.log(
      `[transcribe] submitted artifact=${artifactId} job=${jobOcid.slice(-12)}`,
    );
    return { status: 'transcribing', jobOcid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[transcribe] submit failed for ${artifactId}: ${msg}`);
    await updateTranscriptionStatus(cfg, artifactId, {
      status: 'failed',
      error: msg,
      clearJob: true,
    });
    return { status: 'failed', error: msg };
  }
}

/**
 * Reset a failed/skipped/null row and re-submit the job. Used by the
 * "Retry" button in the Library UI and by the --include-failed path of
 * the backfill CLI.
 */
export async function retryTranscription(
  cfg: CorpusConfig,
  artifactId: string,
): Promise<EnqueueOutcome> {
  // Wipe previous status so enqueue takes the submit path.
  await updateTranscriptionStatus(cfg, artifactId, {
    status: 'pending',
    clearJob: true,
    error: null,
  });
  return enqueueTranscription(cfg, artifactId);
}

/**
 * Re-run finaliseTranscription against the existing job OCID, without
 * resubmitting to OCI Speech. This is the right escape hatch when the
 * Speech job finished SUCCEEDED but our finaliser tripped on something
 * local (output-filename guess was wrong, chunking bug, DB transient,
 * etc.) — resubmitting would waste $$ and 5+ minutes for no new info.
 *
 * Contract:
 *   - Row must have a transcription_job_ocid. Otherwise → submit-style
 *     retry via retryTranscription() is the right call.
 *   - Speech-side job state must be SUCCEEDED. Anything else returns
 *     a descriptive EnqueueOutcome so the caller can decide.
 */
export async function refetchTranscription(
  cfg: CorpusConfig,
  artifactId: string,
): Promise<EnqueueOutcome> {
  if (!cfg.speechEnabled) {
    return { status: 'skipped', reason: 'OCI_SPEECH_ENABLED=false' };
  }

  const art = await loadArtifact(cfg, artifactId);
  if (!art) {
    throw new Error(`refetchTranscription: artifact ${artifactId} not found`);
  }
  if (!art.transcriptionJobOcid) {
    return {
      status: 'failed',
      error: 'no job OCID on artifact — use retry (re-submit) instead',
    };
  }

  // Verify Speech-side the job really is SUCCEEDED before we spend cycles.
  let view: { status: TranscriptionJobStatus; lifecycleDetails?: string };
  try {
    view = await getTranscriptionJob(cfg, art.transcriptionJobOcid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: `poll: ${msg}` };
  }

  if (view.status !== 'SUCCEEDED') {
    return {
      status: 'failed',
      error: `job ${view.status}, not SUCCEEDED — cannot refetch`,
    };
  }

  // Flip the row back to 'transcribing' so finaliseTranscription can
  // run its usual DELETE+INSERT path idempotently (the guarded UPDATE
  // inside updateTranscriptionStatus won't conflict with other ticks
  // since no other tick can pick this row up at 'failed').
  await updateTranscriptionStatus(cfg, artifactId, {
    status: 'transcribing',
    error: null,
  });

  const outcome = await finaliseTranscription(cfg, {
    id: art.id,
    kind: art.kind,
    bucket: art.bucket,
    objectName: art.objectName,
    mimeType: art.mimeType,
    sizeBytes: art.sizeBytes,
    transcriptionStatus: 'transcribing',
    transcriptionJobOcid: art.transcriptionJobOcid,
  });
  return outcome === 'done'
    ? { status: 'transcribing', jobOcid: art.transcriptionJobOcid } // reuses existing OCID
    : { status: 'failed', error: 'finalise failed (see row error)' };
}

// ─── Finalise (SUCCEEDED jobs) ───────────────────────────────────────────

/**
 * Fetch the Speech JSON output, chunk + embed the transcript text, and
 * write the chunks to `artifact_chunks`. Flips status to 'done' on success
 * or 'failed' if chunking/embedding/insert fails.
 *
 * Returns the terminal status so the caller (reconcileOnce) can keep an
 * accurate tick-level counter of done-vs-failed outcomes.
 */
async function finaliseTranscription(
  cfg: CorpusConfig,
  art: ArtifactForTranscription,
): Promise<'done' | 'failed'> {
  let transcript: { text: string; objectName: string } | null;
  try {
    transcript = await fetchTranscriptText(cfg, art.transcriptionJobOcid!);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'failed',
      error: `fetch output: ${msg}`,
    });
    return 'failed';
  }

  if (!transcript || transcript.text.trim().length === 0) {
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'failed',
      error: transcript
        ? 'empty transcript (model returned no text)'
        : 'output object not found under transcripts/job-<ocid>/',
    });
    return 'failed';
  }

  const chunks = chunkText(transcript.text);
  if (chunks.length === 0) {
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'done',
      error: null,
    });
    console.log(
      `[transcribe] finalised artifact=${art.id} chunks=0 source=${transcript.objectName}`,
    );
    return 'done';
  }

  let vectors: number[][];
  try {
    vectors = await embedTexts(
      cfg,
      chunks.map((c) => c.text),
      'SEARCH_DOCUMENT',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'failed',
      error: `embed: ${msg}`,
    });
    return 'failed';
  }
  if (vectors.length !== chunks.length) {
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'failed',
      error: `embed count mismatch: ${vectors.length}/${chunks.length}`,
    });
    return 'failed';
  }

  try {
    await withConnection(cfg, async (conn) => {
      // Defensive: wipe any pre-existing chunks for this artifact (e.g. a
      // prior partial finalise). Idempotent retry story.
      await conn.execute(
        `DELETE FROM artifact_chunks WHERE artifact_id = :aid`,
        { aid: art.id },
        { autoCommit: false },
      );

      const rows = chunks.map((c, i) => ({
        cid: newId(),
        aid: art.id,
        ord: c.ordinal,
        txt: c.text,
        cs: c.charStart,
        ce: c.charEnd,
        tc: c.tokenEstimate,
        emb: Float32Array.from(vectors[i] as number[]),
      }));
      await conn.executeMany(
        `INSERT INTO artifact_chunks
           (id, artifact_id, ordinal, text, char_start, char_end, token_count, embedding)
         VALUES (:cid, :aid, :ord, :txt, :cs, :ce, :tc, :emb)`,
        rows as unknown as oracledb.BindParameters[],
        {
          bindDefs: {
            cid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
            aid: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 26 },
            ord: { type: oracledb.DB_TYPE_NUMBER },
            txt: { type: oracledb.DB_TYPE_VARCHAR, maxSize: 32000 },
            cs: { type: oracledb.DB_TYPE_NUMBER },
            ce: { type: oracledb.DB_TYPE_NUMBER },
            tc: { type: oracledb.DB_TYPE_NUMBER },
            emb: { type: oracledb.DB_TYPE_VECTOR },
          },
          autoCommit: false,
        },
      );
      await conn.commit();
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTranscriptionStatus(cfg, art.id, {
      status: 'failed',
      error: `insert chunks: ${msg}`,
    });
    return 'failed';
  }

  await updateTranscriptionStatus(cfg, art.id, {
    status: 'done',
    error: null,
  });
  console.log(
    `[transcribe] finalised artifact=${art.id} chunks=${chunks.length} source=${transcript.objectName}`,
  );
  return 'done';
}

// ─── Poller tick ─────────────────────────────────────────────────────────

/**
 * One reconcile pass. Finds every artifact currently 'transcribing',
 * checks its job status in OCI Speech, and advances the row.
 *
 * Exported for tests and the backfill CLI.
 */
export async function reconcileOnce(cfg: CorpusConfig): Promise<{
  scanned: number;
  finalised: number;
  failed: number;
  stillRunning: number;
}> {
  if (!cfg.speechEnabled) {
    return { scanned: 0, finalised: 0, failed: 0, stillRunning: 0 };
  }

  interface PendingRow {
    ID: string;
    KIND: string;
    BUCKET: string;
    OBJECT_NAME: string;
    MIME_TYPE: string | null;
    SIZE_BYTES: number | null;
    TRANSCRIPTION_JOB_OCID: string;
  }

  const pending = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<PendingRow>(
      `SELECT id, kind, bucket, object_name, mime_type, size_bytes, transcription_job_ocid
         FROM artifacts
        WHERE transcription_status = 'transcribing'
          AND transcription_job_ocid IS NOT NULL`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });

  if (pending.length === 0) {
    return { scanned: 0, finalised: 0, failed: 0, stillRunning: 0 };
  }

  // Phase 1 — classify every row by its OCI Speech lifecycle state.
  const toFinalise: ArtifactForTranscription[] = [];
  const results = { scanned: pending.length, finalised: 0, failed: 0, stillRunning: 0 };

  for (const row of pending) {
    const art: ArtifactForTranscription = {
      id: row.ID,
      kind: row.KIND,
      bucket: row.BUCKET,
      objectName: row.OBJECT_NAME,
      mimeType: row.MIME_TYPE,
      sizeBytes: row.SIZE_BYTES,
      transcriptionStatus: 'transcribing',
      transcriptionJobOcid: row.TRANSCRIPTION_JOB_OCID,
    };
    let view: { status: TranscriptionJobStatus; lifecycleDetails?: string };
    try {
      view = await getTranscriptionJob(cfg, row.TRANSCRIPTION_JOB_OCID);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateTranscriptionStatus(cfg, row.ID, {
        status: 'failed',
        error: `poll: ${msg}`,
      });
      results.failed += 1;
      continue;
    }

    switch (view.status) {
      case 'SUCCEEDED':
        toFinalise.push(art);
        break;
      case 'FAILED':
      case 'CANCELED':
        await updateTranscriptionStatus(cfg, row.ID, {
          status: 'failed',
          error: view.lifecycleDetails ?? `job ${view.status}`,
        });
        results.failed += 1;
        break;
      case 'ACCEPTED':
      case 'IN_PROGRESS':
      case 'CANCELING':
      default:
        results.stillRunning += 1;
    }
  }

  // Phase 2 — finalise SUCCEEDED jobs with bounded parallelism. We
  // count done-vs-failed outcomes separately so the tick-level log
  // tells the truth (previously every finalise call incremented
  // `finalised` regardless of whether it actually produced chunks).
  for (let i = 0; i < toFinalise.length; i += FINALISE_CONCURRENCY) {
    const batch = toFinalise.slice(i, i + FINALISE_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((a) => finaliseTranscription(cfg, a)),
    );
    for (const o of outcomes) {
      if (o === 'done') results.finalised += 1;
      else results.failed += 1;
    }
  }

  return results;
}

// ─── Poller lifecycle ────────────────────────────────────────────────────

let activeTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;

/**
 * Start the transcription poller. Returns a `stop()` function that
 * clears the interval. Safe to call multiple times — subsequent calls
 * replace the previous interval.
 */
export function startTranscriptionPoller(cfg: CorpusConfig): {
  stop: () => void;
} {
  if (!cfg.speechEnabled) {
    console.log('[transcribe] poller disabled (OCI_SPEECH_ENABLED=false)');
    return { stop: () => {} };
  }
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = null;
  }

  const intervalMs = cfg.transcribePollMs;
  const tick = async () => {
    if (tickInFlight) return; // skip overlapping ticks
    tickInFlight = true;
    try {
      const result = await reconcileOnce(cfg);
      if (result.scanned > 0) {
        console.log(
          `[transcribe] tick — scanned=${result.scanned} finalised=${result.finalised} ` +
            `failed=${result.failed} still=${result.stillRunning}`,
        );
      }
    } catch (err) {
      console.warn('[transcribe] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      tickInFlight = false;
    }
  };

  activeTimer = setInterval(tick, intervalMs);
  // Fire once shortly after boot so a restart doesn't wait a full interval
  // before reconciling jobs submitted before shutdown.
  setTimeout(() => void tick(), 2000).unref();
  // Don't prevent process shutdown.
  activeTimer.unref();

  console.log(
    `[transcribe] poller started — interval=${intervalMs}ms language=${cfg.speechLanguage}`,
  );

  return {
    stop: () => {
      if (activeTimer) {
        clearInterval(activeTimer);
        activeTimer = null;
      }
    },
  };
}
