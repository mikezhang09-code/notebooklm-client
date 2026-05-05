-- M7 migration: transcription status columns on artifacts.
-- Idempotent — safe to run multiple times; each ALTER and CREATE INDEX
-- statement is wrapped in its own PL/SQL block that swallows "already
-- exists" / "column already exists" errors.
--
-- Usage (as CORPUS user via Database Actions → SQL):
--   @schema.alter-transcription.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) transcription_status  VARCHAR2(20)   null | pending | transcribing | done | failed | skipped
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);  -- column being added already exists
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifacts ADD (transcription_status VARCHAR2(20))';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) transcription_job_ocid  VARCHAR2(255)   OCI Speech job OCID (for polling)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifacts ADD (transcription_job_ocid VARCHAR2(255))';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) transcribed_at  TIMESTAMP              when the transcript was finalised
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifacts ADD (transcribed_at TIMESTAMP WITH LOCAL TIME ZONE)';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) transcription_error  VARCHAR2(2000)    last failure message (if any)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifacts ADD (transcription_error VARCHAR2(2000))';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Filter index for the poller's cheap hot-path scan:
--       WHERE transcription_status = 'transcribing'
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
  PRAGMA EXCEPTION_INIT(e_already_exists, -1408);
BEGIN
  EXECUTE IMMEDIATE 'CREATE INDEX ix_artifacts_trx_status ON artifacts(transcription_status)';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, data_length
  FROM user_tab_columns
 WHERE table_name = 'ARTIFACTS'
   AND column_name IN (
     'TRANSCRIPTION_STATUS',
     'TRANSCRIPTION_JOB_OCID',
     'TRANSCRIBED_AT',
     'TRANSCRIPTION_ERROR'
   )
 ORDER BY column_name;

SELECT index_name, table_name
  FROM user_indexes
 WHERE index_name = 'IX_ARTIFACTS_TRX_STATUS';
