/**
 * Corpus subsystem facade.
 *
 * Single import surface for the rest of the webapp. Returns null-shaped
 * results when the subsystem is disabled (no env config) so route handlers
 * can render a friendly "not configured" state instead of crashing.
 */

export { getCorpusConfig } from './config.js';
export type { CorpusConfig } from './config.js';

export { dbHealthCheck, withConnection, closeDbPool } from './oci/db.js';
export {
  storageHealthCheck,
  putObject,
  createReadPar,
  deleteObject,
} from './oci/storage.js';
export { genaiHealthCheck, embedTexts } from './oci/genai.js';
export type { EmbedInputType } from './oci/genai.js';

export { searchCorpus } from './search.js';
export type {
  SearchOptions,
  SearchResult,
  SearchHit,
  SearchSnippet,
} from './search.js';

import { getCorpusConfig } from './config.js';
import { dbHealthCheck } from './oci/db.js';
import { storageHealthCheck } from './oci/storage.js';
import { genaiHealthCheck } from './oci/genai.js';

export interface CorpusHealth {
  enabled: boolean;
  region?: string;
  bucket?: string;
  db: { ok: boolean; version?: string; user?: string; error?: string };
  storage: { ok: boolean; bucket?: string; approxObjectCount?: number; error?: string };
  genai: { ok: boolean; model?: string; dimensions?: number; error?: string };
}

/**
 * End-to-end smoke test of all three OCI services. Runs the three checks
 * in parallel — if the user's network or IAM is broken we still get a
 * full picture in one round-trip.
 */
export async function corpusHealth(): Promise<CorpusHealth> {
  const cfg = await getCorpusConfig();
  if (!cfg) {
    return {
      enabled: false,
      db: { ok: false, error: 'corpus disabled (env vars missing)' },
      storage: { ok: false, error: 'corpus disabled' },
      genai: { ok: false, error: 'corpus disabled' },
    };
  }
  const [db, storage, genai] = await Promise.all([
    dbHealthCheck(cfg),
    storageHealthCheck(cfg),
    genaiHealthCheck(cfg),
  ]);
  return {
    enabled: true,
    region: cfg.ociRegion,
    bucket: cfg.ociBucket,
    db,
    storage,
    genai,
  };
}
