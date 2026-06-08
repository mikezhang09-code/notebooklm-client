-- Notebook-level tags migration.
--
-- A "notebook" in the corpus is otherwise virtual — just a grouping of
-- artifacts that share `notebook_id` (mirrored from Google NotebookLM, whose
-- name + artifacts we don't own). This table gives a notebook a place to hold
-- *our* metadata: library-side tags that propagate to every saved artifact of
-- that notebook (and are inherited by artifacts saved later).
--
-- Symmetric with `collections.tags`. The propagation itself happens in
-- application code (corpus/tags.ts), not triggers, so the merge semantics
-- (union with each artifact's own manual tags) stay testable.
--
-- Idempotent — safe to run multiple times.
--
-- Usage (from webapp/):
--   npx tsx server/corpus/run-migration.ts schema.alter-notebooks.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) notebooks table — one row per NotebookLM notebook we've tagged.
--    `id` matches artifacts.notebook_id (VARCHAR2(64)). Rows are created lazily
--    the first time a notebook is tagged; absence simply means "no notebook tags".
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE notebooks (
      id          VARCHAR2(64)  NOT NULL,            -- NotebookLM notebook id
      title       VARCHAR2(512),                     -- last-known display name (optional)
      tags        JSON,                              -- notebook-level tags
      metadata    JSON,                              -- arbitrary extras
      created_at  TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      updated_at  TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT pk_notebooks PRIMARY KEY (id)
    )
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name FROM user_tables WHERE table_name = 'NOTEBOOKS';

SELECT column_name, data_type
  FROM user_tab_cols
 WHERE table_name = 'NOTEBOOKS'
 ORDER BY column_id;
