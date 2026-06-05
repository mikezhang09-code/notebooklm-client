-- Collections + artifact categorization + tag-search migration.
--
-- Adds the three-way organization model:
--   1) NotebookLM artifacts   — origin='notebooklm' (notebook_id + artifact_id)
--   2) Collection uploads     — origin='upload' AND collection_id IS NOT NULL
--   3) Free-form uploads      — origin='upload' AND collection_id IS NULL
--
-- The `category` column below is DERIVED (virtual) from origin + collection_id,
-- so existing rows classify automatically — no data backfill needed.
--
-- Idempotent — safe to run multiple times; every statement is wrapped in its
-- own PL/SQL block that swallows "already exists" errors.
--
-- Usage (as CORPUS user via Database Actions -> SQL, or run-migration.ts):
--   @schema.alter-collections.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) collections table — one row per user-created collection (a bag of uploads).
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);   -- name already used by an existing object
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE collections (
      id          VARCHAR2(26)  NOT NULL,            -- ULID
      name        VARCHAR2(256) NOT NULL,
      description VARCHAR2(2000),
      tags        JSON,                              -- collection-level tags
      metadata    JSON,                              -- arbitrary extras (color, owner, ...)
      created_at  TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      updated_at  TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT pk_collections PRIMARY KEY (id)
    )
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- Case-insensitive unique collection name (prevents "Acme" and "acme" duplicates).
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
  PRAGMA EXCEPTION_INIT(e_already_exists, -1408);
BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX ix_collections_name_uq ON collections (UPPER(name))';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) artifacts.collection_id — nullable FK to collections. NULL = free-form upload.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);  -- column being added already exists
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifacts ADD (collection_id VARCHAR2(26))';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- FK with ON DELETE SET NULL: deleting a collection demotes its artifacts to
-- free-form rather than destroying them.
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -2275);  -- such a referential constraint already exists
  PRAGMA EXCEPTION_INIT(e_already_exists, -2264);  -- constraint name already used
BEGIN
  EXECUTE IMMEDIATE q'[
    ALTER TABLE artifacts
      ADD CONSTRAINT fk_artifacts_collection
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) artifacts.category — VIRTUAL column derived from origin + collection_id.
--    notebooklm | collection | freeform. No backfill needed; computed on read.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -1430);  -- column already exists
BEGIN
  EXECUTE IMMEDIATE q'[
    ALTER TABLE artifacts ADD (
      category AS (
        CASE
          WHEN origin = 'notebooklm'     THEN 'notebooklm'
          WHEN collection_id IS NOT NULL THEN 'collection'
          ELSE 'freeform'
        END
      )
    )
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Filter indexes: collection membership + category browsing.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
  PRAGMA EXCEPTION_INIT(e_already_exists, -1408);
BEGIN
  BEGIN EXECUTE IMMEDIATE 'CREATE INDEX ix_artifacts_collection ON artifacts(collection_id)'; EXCEPTION WHEN e_already_exists THEN NULL; END;
  BEGIN EXECUTE IMMEDIATE 'CREATE INDEX ix_artifacts_category   ON artifacts(category)';      EXCEPTION WHEN e_already_exists THEN NULL; END;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Tag search: multivalue index over the JSON `tags` array so that
--       WHERE JSON_EXISTS(tags, '$[*]?(@ == "tencent")')
--    (i.e. tag-membership filtering) is index-backed rather than a full scan.
--
--    If your ADB version rejects the multivalue syntax, comment this block
--    out — tag filtering still works without the index, just unindexed.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE
  e_already_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_already_exists, -955);
  PRAGMA EXCEPTION_INIT(e_already_exists, -1408);
  PRAGMA EXCEPTION_INIT(e_already_exists, -29855);
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE MULTIVALUE INDEX ix_artifacts_tags_mv
      ON artifacts a (a.tags.string())
  ]';
EXCEPTION WHEN e_already_exists THEN NULL;
END;
/

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_name FROM user_tables WHERE table_name = 'COLLECTIONS';

SELECT column_name, data_type, data_default, virtual_column
  FROM user_tab_cols
 WHERE table_name = 'ARTIFACTS'
   AND column_name IN ('COLLECTION_ID', 'CATEGORY')
 ORDER BY column_name;

SELECT constraint_name, delete_rule
  FROM user_constraints
 WHERE constraint_name = 'FK_ARTIFACTS_COLLECTION';

SELECT index_name, table_name
  FROM user_indexes
 WHERE index_name IN (
     'IX_COLLECTIONS_NAME_UQ',
     'IX_ARTIFACTS_COLLECTION',
     'IX_ARTIFACTS_CATEGORY',
     'IX_ARTIFACTS_TAGS_MV'
   )
 ORDER BY index_name;
