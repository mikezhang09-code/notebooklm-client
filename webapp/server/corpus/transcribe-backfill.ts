/**
 * M7 backfill CLI — enqueue transcription jobs for existing audio/video
 * artifacts that predate the M7 upgrade (or that were ingested while
 * OCI_SPEECH_ENABLED was off).
 *
 * Usage (from webapp/):
 *   npx tsx server/corpus/transcribe-backfill.ts           # dry-run — lists targets
 *   npx tsx server/corpus/transcribe-backfill.ts --apply   # actually submit jobs
 *
 * By default only rows with NULL or 'skipped' transcription_status are
 * picked up. Pass --include-failed to also retry rows that failed in a
 * previous run (useful when Speech was temporarily down).
 *
 * Safe to re-run. enqueueTranscription is idempotent — rows already
 * 'transcribing' or 'done' are left alone.
 */

import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';
import {
  enqueueTranscription,
  retryTranscription,
  type EnqueueOutcome,
} from './transcribe.js';

interface BackfillRow {
  ID: string;
  KIND: string;
  TITLE: string;
  SIZE_BYTES: number | null;
  TRANSCRIPTION_STATUS: string | null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeFailed = args.includes('--include-failed');

  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('[backfill] corpus is not configured (missing env vars)');
    process.exit(2);
  }
  if (!cfg.speechEnabled) {
    console.error(
      '[backfill] OCI_SPEECH_ENABLED is false — refusing to run. Enable it or remove the flag.',
    );
    process.exit(2);
  }

  const statusClause = includeFailed
    ? `(transcription_status IS NULL OR transcription_status IN ('skipped','failed','pending'))`
    : `(transcription_status IS NULL OR transcription_status IN ('skipped','pending'))`;

  const rows = await withConnection(cfg, async (conn) => {
    const r = await conn.execute<BackfillRow>(
      `SELECT id, kind, title, size_bytes, transcription_status
         FROM artifacts
        WHERE kind IN ('audio','video')
          AND ${statusClause}
        ORDER BY created_at ASC`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return r.rows ?? [];
  });

  if (rows.length === 0) {
    console.log(
      `[backfill] no audio/video rows need transcription ` +
        `(status filter: ${includeFailed ? 'null|skipped|failed|pending' : 'null|skipped|pending'})`,
    );
    return;
  }

  console.log(`[backfill] matched ${rows.length} row(s):`);
  for (const r of rows) {
    const sz = r.SIZE_BYTES != null ? `${(r.SIZE_BYTES / 1024 / 1024).toFixed(1)} MB` : '?';
    const st = r.TRANSCRIPTION_STATUS ?? 'null';
    console.log(`  - [${st.padEnd(12)}] ${r.KIND.padEnd(5)} ${sz.padStart(8)}  ${r.ID}  ${r.TITLE.slice(0, 60)}`);
  }

  if (!apply) {
    console.log(`\n[backfill] dry-run complete. Re-run with --apply to submit ${rows.length} job(s).`);
    return;
  }

  console.log(`\n[backfill] submitting ${rows.length} job(s)…`);
  let submitted = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rows) {
    let outcome: EnqueueOutcome;
    try {
      // 'failed' rows must go through retryTranscription — enqueue
      // short-circuits on any non-null, non-'pending' status to stay
      // idempotent. For null / 'skipped' / 'pending' rows the plain
      // enqueue path is enough.
      outcome =
        r.TRANSCRIPTION_STATUS === 'failed'
          ? await retryTranscription(cfg, r.ID)
          : await enqueueTranscription(cfg, r.ID);
    } catch (err) {
      failed += 1;
      console.warn(
        `  ✗ ${r.ID} — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    switch (outcome.status) {
      case 'transcribing':
        submitted += 1;
        console.log(`  ✓ ${r.ID}  job=…${outcome.jobOcid.slice(-12)}`);
        break;
      case 'already_running':
        skipped += 1;
        console.log(
          `  ↻ ${r.ID}  already running (job=…${outcome.jobOcid.slice(-12)})`,
        );
        break;
      case 'already_done':
        skipped += 1;
        console.log(`  · ${r.ID}  already done`);
        break;
      case 'skipped':
        skipped += 1;
        console.log(`  · ${r.ID}  skipped (${outcome.reason})`);
        break;
      case 'failed':
        failed += 1;
        console.warn(`  ✗ ${r.ID}  ${outcome.error}`);
        break;
    }
  }
  console.log(
    `\n[backfill] done. submitted=${submitted} failed=${failed} skipped=${skipped}`,
  );
  console.log(
    `[backfill] watch status with: curl ${process.env['PORT'] ? `http://localhost:${process.env['PORT']}` : 'http://localhost:7860'}/api/corpus/artifacts?kind=audio | jq '.items[] | {id:.ID, trx:.TRANSCRIPTION_STATUS}'`,
  );
}

main().catch((err) => {
  console.error('[backfill] fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
