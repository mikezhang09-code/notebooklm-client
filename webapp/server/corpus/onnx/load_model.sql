-- ─────────────────────────────────────────────────────────────────────────
-- Load the BGE-M3 ONNX model into Oracle Autonomous Database.
--
-- Prerequisites:
--   1. Run convert_bge_m3.py on a Linux machine with OML4Py to produce
--      the augmented ONNX file (bge_m3_augmented.onnx)
--   2. Upload the .onnx file to your OCI Object Storage bucket
--   3. Create a credential in the database for Object Storage access
--
-- Run this SQL in Database Actions → SQL Worksheet as the CORPUS user.
-- ─────────────────────────────────────────────────────────────────────────

-- Step 1: Create a credential for accessing Object Storage (one-time setup).
-- Replace the OCIDs and API key details with your actual values.
-- Skip this if you already have a credential set up.
/*
BEGIN
  DBMS_CLOUD.CREATE_CREDENTIAL(
    credential_name => 'OCI_OBJECT_STORE_CRED',
    user_ocid       => 'ocid1.user.oc1..your-user-ocid',
    tenancy_ocid    => 'ocid1.tenancy.oc1..your-tenancy-ocid',
    private_key     => 'your-private-key-pem-content',
    fingerprint     => 'xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx'
  );
END;
/
*/

-- Step 2: Load the ONNX model from Object Storage.
-- Update the URI to match your bucket/namespace/object path.
BEGIN
  DBMS_VECTOR.LOAD_ONNX_MODEL_CLOUD(
    model_name => 'BGE_M3_MODEL',
    credential => 'OCI_OBJECT_STORE_CRED',
    uri        => 'https://objectstorage.ap-tokyo-1.oraclecloud.com/n/nrxusfgp0z2e/b/nblm-corpus/o/bge_m3_augmented.onnx',
    metadata   => JSON('{"function":"embedding", "embeddingOutput":"embedding", "input":{"input":["DATA"]}}')
  );
END;
/

-- Step 3: Verify the model is loaded and produces correct dimensions.
SELECT model_name, algorithm, mining_function
  FROM user_mining_models
 WHERE mining_function = 'EMBEDDING';

-- Step 4: Test embedding generation (should return a 1024-dim vector).
SELECT VECTOR_EMBEDDING(BGE_M3_MODEL USING '你好世界 hello world' AS DATA) AS emb
  FROM DUAL;

-- ─────────────────────────────────────────────────────────────────────────
-- Step 5: Re-embed all existing chunks with the new model.
-- WARNING: This overwrites all existing embeddings. Only run after you've
-- verified the model works correctly and set EMBEDDING_PROVIDER=database.
-- ─────────────────────────────────────────────────────────────────────────
/*
UPDATE artifact_chunks
   SET embedding = VECTOR_EMBEDDING(BGE_M3_MODEL USING text AS DATA);
COMMIT;

-- Rebuild the HNSW vector index after bulk update.
ALTER INDEX ix_chunks_vec REBUILD;
*/
