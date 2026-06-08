/**
 * Re-index artifacts that have no chunks (CLI wrapper).
 *
 * The actual logic lives in `reembed-core.ts`, shared with the
 * `/api/corpus/reembed` route (Diagnose → Search index panel). This file is
 * just the command-line front-end.
 *
 * Usage (from webapp/):
 *   npx tsx server/corpus/reembed.ts                 # dry run — list 0-chunk docs
 *   npx tsx server/corpus/reembed.ts --apply         # extract + embed + write
 *   npx tsx server/corpus/reembed.ts --apply <id>... # only the given artifact ids
 */
import { getCorpusConfig } from './config.js';
import { listTargets, reembedOne, type Status } from './reembed-core.js';

async function main() {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('Corpus is disabled (missing env). Cannot re-embed.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((a) => !a.startsWith('--'));

  const targets = await listTargets(cfg, ids);
  if (targets.length === 0) {
    console.log('Nothing to re-embed — no matching artifacts found.');
    return;
  }
  console.log(
    `${apply ? 'Re-embedding' : 'DRY RUN —'} ${targets.length} artifact(s)` +
      (apply ? '' : ' (pass --apply to write):') + '\n',
  );

  const tally: Record<Status, number> = {
    indexed: 0, 'would-index': 0, 'would-ocr': 0, 'no-text': 0,
    'fetch-failed': 0, 'ocr-failed': 0, 'embed-failed': 0,
  };
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]!;
    const o = await reembedOne(cfg, row, apply);
    tally[o.status]++;
    const detail =
      o.status === 'indexed' || o.status === 'would-index'
        ? `${o.chunks} chunks, ${o.chars} chars${o.viaOcr ? ' (via OCR)' : ''}`
        : o.status === 'would-ocr'
          ? 'will OCR with Gemini, then index'
          : o.status === 'no-text'
            ? 'no extractable text (audio/video, or OCR found none)'
            : o.error ?? '';
    console.log(`  [${o.status.padEnd(12)}] ${row.TITLE} — ${detail}`);
    // Gentle throttle between live OCR/embed calls to respect free-tier limits.
    if (apply && i < targets.length - 1) await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(
    `\nSummary: ${tally.indexed} indexed, ${tally['would-index']} would-index, ` +
      `${tally['would-ocr']} would-ocr, ${tally['no-text']} no-text, ` +
      `${tally['fetch-failed']} fetch-failed, ${tally['ocr-failed']} ocr-failed, ${tally['embed-failed']} embed-failed`,
  );
  if (!apply && (tally['would-index'] > 0 || tally['would-ocr'] > 0)) {
    console.log('Re-run with --apply to index them.');
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FATAL:', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  },
);
