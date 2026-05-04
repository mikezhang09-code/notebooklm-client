/**
 * Stand-alone corpus health probe.
 *
 * Usage (from repo root):
 *   npx --workspace webapp tsx server/corpus/check.ts
 *
 * Loads the repo-root .env, runs dbHealthCheck / storageHealthCheck /
 * genaiHealthCheck in parallel, prints the JSON result, exits 0 on full
 * success, 1 if any subsystem fails.
 */

import { corpusHealth, closeDbPool } from './index.js';

async function main(): Promise<number> {
  const health = await corpusHealth();
  console.log(JSON.stringify(health, null, 2));
  await closeDbPool();
  if (!health.enabled) return 1;
  if (!health.db.ok || !health.storage.ok || !health.genai.ok) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('unexpected error:', err);
    process.exit(2);
  });
