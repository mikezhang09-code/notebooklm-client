-- Re-dimension the artifact_chunks embedding column for a new provider.
--
-- Switching embedding providers (e.g. Gemini 3072-dim → Voyage 1024-dim) needs
-- the VECTOR column dimension to match the model. You cannot mix dimensions in
-- a cosine search, so this:
--   1) drops the vector index
--   2) WIPES all chunk rows (embeddings become useless under the new model;
--      the chunk TEXT is regenerated from the stored source blobs on re-embed)
--   3) recreates the embedding column at the new dimension
--   4) recreates the vector index
--
-- ⚠️  DESTRUCTIVE for the artifact_chunks table only. The `artifacts` catalog
--     and the Object Storage blobs are untouched. After running this, re-embed
--     everything:  cd webapp && npx tsx scripts/reembed.ts
--
-- The dimension below (1024) MUST equal VOYAGE_EMBED_DIM in .env.
-- Run as the CORPUS user (Database Actions -> SQL, or run-migration.ts).

-- 1) Drop the vector index (it's bound to the old dimension).
DECLARE
  e_missing EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_missing, -1418);   -- index does not exist
  PRAGMA EXCEPTION_INIT(e_missing, -29855);  -- domain/vector index error
BEGIN
  EXECUTE IMMEDIATE 'DROP INDEX ix_chunks_vec';
EXCEPTION WHEN e_missing THEN NULL;
END;
/

-- 2) Wipe all chunks (old-dimension embeddings are incompatible).
BEGIN
  EXECUTE IMMEDIATE 'DELETE FROM artifact_chunks';
  COMMIT;
END;
/

-- 3) Drop + re-add the embedding column at the new dimension.
DECLARE
  e_missing EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_missing, -904);   -- invalid identifier (column absent)
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifact_chunks DROP COLUMN embedding';
EXCEPTION WHEN e_missing THEN NULL;
END;
/
DECLARE
  e_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_exists, -1430);   -- column already exists
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE artifact_chunks ADD (embedding VECTOR(1024, FLOAT32))';
EXCEPTION WHEN e_exists THEN NULL;
END;
/

-- 4) Recreate the approximate vector index.
DECLARE
  e_exists EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_exists, -955);
  PRAGMA EXCEPTION_INIT(e_exists, -51000);
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE VECTOR INDEX ix_chunks_vec
      ON artifact_chunks(embedding)
      ORGANIZATION INMEMORY NEIGHBOR GRAPH
      DISTANCE COSINE
      WITH TARGET ACCURACY 90
  ]';
EXCEPTION WHEN e_exists THEN NULL;
END;
/

-- Verify
SELECT column_name, data_type FROM user_tab_columns
 WHERE table_name = 'ARTIFACT_CHUNKS' AND column_name = 'EMBEDDING';
SELECT COUNT(*) AS remaining_chunks FROM artifact_chunks;
