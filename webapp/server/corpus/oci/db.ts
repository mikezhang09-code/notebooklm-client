/**
 * Oracle Autonomous Database connection pool.
 *
 * Uses node-oracledb 6.x **Thin mode** with mTLS wallet authentication —
 * no Oracle Instant Client required. The wallet directory must contain
 * `ewallet.pem` (decrypted via the wallet password) and `tnsnames.ora`
 * (so the connect string alias resolves).
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from '../config.js';

let poolPromise: Promise<oracledb.Pool> | null = null;

/**
 * Lazily create (or reuse) the connection pool. Subsequent calls return
 * the same pool instance.
 */
export async function getDbPool(cfg: CorpusConfig): Promise<oracledb.Pool> {
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    // Tell oracledb to default LOBs to JS strings/buffers — easier than streaming
    // for our corpus chunks (max ~2KB per row).
    oracledb.fetchAsString = [oracledb.CLOB];
    oracledb.fetchAsBuffer = [oracledb.BLOB];

    const pool = await oracledb.createPool({
      user: cfg.oracleUser,
      password: cfg.oraclePassword,
      connectString: cfg.oracleConnectString,
      // Thin-mode mTLS: walletLocation is the dir containing ewallet.pem,
      // walletPassword is what you set in OCI Console when downloading.
      walletLocation: cfg.oracleWalletDir,
      walletPassword: cfg.oracleWalletPassword,
      // configDir is where Thin mode looks for tnsnames.ora to resolve
      // the connectString alias (e.g. nblmcorpus_high → full descriptor).
      configDir: cfg.oracleWalletDir,
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 60,
    });

    return pool;
  })();

  try {
    return await poolPromise;
  } catch (err) {
    poolPromise = null; // allow retry on next call
    throw err;
  }
}

/**
 * Close the pool — useful on shutdown.
 */
export async function closeDbPool(): Promise<void> {
  if (!poolPromise) return;
  try {
    const pool = await poolPromise;
    await pool.close(10);
  } finally {
    poolPromise = null;
  }
}

/**
 * Borrow a connection from the pool, run `fn`, release the connection
 * regardless of outcome. Use this for every DB op so connections never leak.
 */
export async function withConnection<T>(
  cfg: CorpusConfig,
  fn: (conn: oracledb.Connection) => Promise<T>,
): Promise<T> {
  const pool = await getDbPool(cfg);
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    try {
      await conn.close();
    } catch {
      /* swallow — pool will reap */
    }
  }
}

/**
 * Health check — runs `SELECT 1 FROM dual` and verifies the round-trip.
 * Returns the DB banner so we can surface the version in /api/corpus/health.
 */
export async function dbHealthCheck(cfg: CorpusConfig): Promise<{
  ok: boolean;
  version?: string;
  user?: string;
  error?: string;
}> {
  try {
    return await withConnection(cfg, async (conn) => {
      const ping = await conn.execute<{ ONE: number }>(
        `SELECT 1 AS one FROM dual`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      if (!ping.rows || ping.rows[0]?.ONE !== 1) {
        return { ok: false, error: 'unexpected ping result' };
      }
      const banner = await conn.execute<{ BANNER: string }>(
        `SELECT BANNER FROM v$version WHERE ROWNUM = 1`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const who = await conn.execute<{ U: string }>(
        `SELECT USER AS u FROM dual`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return {
        ok: true,
        version: banner.rows?.[0]?.BANNER ?? 'unknown',
        user: who.rows?.[0]?.U ?? 'unknown',
      };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
