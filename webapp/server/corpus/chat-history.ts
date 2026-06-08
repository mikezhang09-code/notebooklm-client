/**
 * Server-side chat persistence (optional, DB-backed).
 *
 * Two small tables in the corpus ADB:
 *   • corpus_settings — a generic key/value store; we use the `chat_persist`
 *     key to hold the single global "save chats to the library" switch.
 *   • chat_threads    — one row per chat scope (collection / document / corpus),
 *     holding the full message thread as a JSON CLOB.
 *
 * When the switch is ON, the webapp saves each completed conversation here so it
 * shows up on every device pointed at the same database. When OFF, the client
 * keeps history in the browser only and never calls these endpoints to write.
 *
 * The schema is created on first use (idempotent), so no manual migration is
 * required — though `schema.alter-chat-history.sql` mirrors it for parity with
 * the other corpus migrations.
 */

import oracledb from 'oracledb';
import type { CorpusConfig } from './config.js';
import { withConnection } from './oci/db.js';

/** Global settings key holding the on/off switch. */
const PERSIST_KEY = 'chat_persist';

/** Create the settings + thread tables if they don't exist (idempotent). */
const SETTINGS_DDL = `
BEGIN
  EXECUTE IMMEDIATE 'CREATE TABLE corpus_settings (
    skey       VARCHAR2(128) NOT NULL,
    sval       CLOB,
    updated_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_corpus_settings PRIMARY KEY (skey)
  )';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;`;

const THREADS_DDL = `
BEGIN
  EXECUTE IMMEDIATE 'CREATE TABLE chat_threads (
    scope_key  VARCHAR2(256) NOT NULL,
    messages   CLOB,
    updated_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT pk_chat_threads PRIMARY KEY (scope_key)
  )';
EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF;
END;`;

let schemaEnsured = false;

/** Ensure both tables exist. Cheap after the first successful call per process. */
async function ensureChatSchema(cfg: CorpusConfig): Promise<void> {
  if (schemaEnsured) return;
  await withConnection(cfg, async (conn) => {
    await conn.execute(SETTINGS_DDL); // DDL auto-commits
    await conn.execute(THREADS_DDL);
  });
  schemaEnsured = true;
}

/** Read the global "save chats to the library" flag. Defaults to false. */
export async function getChatPersist(cfg: CorpusConfig): Promise<boolean> {
  await ensureChatSchema(cfg);
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute<{ SVAL: string | null }>(
      `SELECT sval FROM corpus_settings WHERE skey = :k`,
      { k: PERSIST_KEY },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const v = r.rows?.[0]?.SVAL;
    return v === 'true' || v === '1';
  });
}

/** Set the global "save chats to the library" flag. */
export async function setChatPersist(cfg: CorpusConfig, on: boolean): Promise<void> {
  await ensureChatSchema(cfg);
  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `MERGE INTO corpus_settings t
         USING (SELECT :k AS skey FROM dual) s ON (t.skey = s.skey)
       WHEN MATCHED THEN UPDATE SET sval = :v, updated_at = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (skey, sval) VALUES (:k, :v)`,
      { k: PERSIST_KEY, v: on ? 'true' : 'false' },
      { autoCommit: true },
    );
  });
}

/** Load a stored thread (parsed JSON array), or null if none exists. */
export async function getChatThread(
  cfg: CorpusConfig,
  scopeKey: string,
): Promise<unknown[] | null> {
  await ensureChatSchema(cfg);
  return withConnection(cfg, async (conn) => {
    const r = await conn.execute<{ MESSAGES: string | null }>(
      `SELECT messages FROM chat_threads WHERE scope_key = :k`,
      { k: scopeKey },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const raw = r.rows?.[0]?.MESSAGES;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
}

/** Upsert a thread. Stores the messages array as a JSON CLOB. */
export async function saveChatThread(
  cfg: CorpusConfig,
  scopeKey: string,
  messages: unknown[],
): Promise<void> {
  await ensureChatSchema(cfg);
  const json = JSON.stringify(Array.isArray(messages) ? messages : []);
  await withConnection(cfg, async (conn) => {
    await conn.execute(
      `MERGE INTO chat_threads t
         USING (SELECT :k AS scope_key FROM dual) s ON (t.scope_key = s.scope_key)
       WHEN MATCHED THEN UPDATE SET messages = :m, updated_at = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (scope_key, messages) VALUES (:k, :m)`,
      {
        k: scopeKey,
        // Bind as CLOB so threads larger than the 32 KB VARCHAR2 bind limit work.
        m: { val: json, type: oracledb.DB_TYPE_CLOB },
      },
      { autoCommit: true },
    );
  });
}

/** Delete a stored thread (used when the user clears a conversation). */
export async function deleteChatThread(cfg: CorpusConfig, scopeKey: string): Promise<void> {
  await ensureChatSchema(cfg);
  await withConnection(cfg, async (conn) => {
    await conn.execute(`DELETE FROM chat_threads WHERE scope_key = :k`, { k: scopeKey }, {
      autoCommit: true,
    });
  });
}
