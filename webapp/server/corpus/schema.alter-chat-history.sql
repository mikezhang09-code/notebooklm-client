-- Chat history persistence migration.
--
-- Adds DB-backed storage for the corpus chat so threads can follow the user
-- across devices when the global "save chats to the library" switch is ON:
--   1) corpus_settings — generic key/value store; key 'chat_persist' holds the
--      single global on/off switch ('true' | 'false').
--   2) chat_threads    — one row per chat scope (collection / document / corpus),
--      storing the full message thread as a JSON CLOB.
--
-- The webapp creates these tables automatically on first use (see
-- chat-history.ts → ensureChatSchema); this file mirrors that DDL for parity
-- with the other corpus migrations and for manual setup if preferred.
--
-- Idempotent — safe to run multiple times.
--
-- Usage (as CORPUS user via Database Actions -> SQL):
--   @schema.alter-chat-history.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) corpus_settings — generic key/value store for app-wide flags.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE corpus_settings (
      skey       VARCHAR2(128) NOT NULL,
      sval       CLOB,
      updated_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT pk_corpus_settings PRIMARY KEY (skey)
    )
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) chat_threads — one row per chat scope, full thread as a JSON CLOB.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE chat_threads (
      scope_key  VARCHAR2(256) NOT NULL,
      messages   CLOB,
      updated_at TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT pk_chat_threads PRIMARY KEY (scope_key)
    )
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name FROM user_tables
 WHERE table_name IN ('CORPUS_SETTINGS','CHAT_THREADS') ORDER BY 1;
