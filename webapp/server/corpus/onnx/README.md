# In-database embeddings: bge-m3 → Oracle 26ai (ONNX)

This directory holds everything needed to run text embeddings **inside** Oracle
AI Database via `VECTOR_EMBEDDING()` instead of calling an external embedding
API (Voyage/Gemini/OCI GenAI). The benefit is zero per-call billing and no
network round-trip; the cost is a one-time model conversion.

> **Status: prepared, not deployed.** As of 2026-06, the in-DB path is
> **blocked on hardware** (see below). The project currently runs on
> `EMBEDDING_PROVIDER=voyage` (1024-dim, multilingual). These files are staged
> so that when an x86_64 machine is available, shipping is a short checklist.

---

## ⚠️ The blocker: OML4Py is x86_64-only

Converting a HuggingFace model into the Oracle-loadable ("augmented") ONNX
format requires **OML4Py 2.1**, whose client is published for **Linux x86_64
only** — there is **no aarch64/ARM build**.

The primary dev host is an **Oracle Ampere A1 (aarch64/ARM)** instance, so the
conversion **cannot run there**. RAM/CPU are fine (~20 GB free, 4 cores); the
architecture is the hard blocker.

**Key insight:** only the *conversion* needs x86_64. The model **load** and the
`VECTOR_EMBEDDING()` calls execute *inside* the ADB, which is
architecture-independent. So once the model is loaded into the DB from any x86
box, the ARM host uses it normally.

| Step | Where it runs | Needs x86_64? |
|------|---------------|---------------|
| Convert HF model → augmented ONNX (OML4Py) | client machine | ✅ yes |
| Load ONNX into ADB (`export2db` / `LOAD_ONNX_MODEL`) | ADB server | ❌ no (any client) |
| `VECTOR_EMBEDDING()` at ingest/search | ADB server | ❌ no |

---

## Why bge-m3 + 26ai specifically

- **bge-m3** outputs **1024-dim** vectors and is strongly multilingual — it
  matches the existing `embedding VECTOR(1024, FLOAT32)` column, so **no schema
  change** is needed (unlike Oracle's pre-built `all-MiniLM-L12-v2`, which is
  384-dim).
- **Oracle 26ai** removed the old 23ai **1 GB ONNX size cap** via *external
  initializers*, so bge-m3's ~2.3 GB weights import fine (subject to DB PGA at
  load time). The verified DB here is `Oracle AI Database 26ai 23.26.2.2.0`.

There is **no ready-to-download Oracle-augmented bge-m3 file** anywhere — the
HuggingFace `BAAI/bge-m3/onnx` files are a standard Optimum export (graph +
external weights + separate tokenizer) and are NOT directly loadable. You must
run the conversion yourself; that's what `convert_bge_m3_26ai.py` does.

---

## Files

| File | Purpose |
|------|---------|
| `convert_bge_m3_26ai.py` | **Primary script.** Converts bge-m3 + loads it into 26ai in one step (`export2db`). Also `--file` (export locally) and `--check` (test DB connection). |
| `requirements.txt` | Pinned OML4Py 2.1 dependency stack (Python 3.12). |
| `convert_bge_m3.py` | Older 23ai-era helper (OML4Py `export2file` + bucket upload). Kept for the bucket/`LOAD_ONNX_MODEL_CLOUD` route. |
| `load_model.sql` | SQL to load from Object Storage + verify + re-embed (the bucket route / fallback). |

---

## Hardware sizing (for the x86 conversion box)

The conversion is a **one-time, CPU-only** export (no GPU needed). Peak memory
spikes to ~**10–14 GB** (PyTorch model + ONNX graph held simultaneously, plus
quantization if enabled). Recommended:

- **≥ 16 GB RAM** (24 GB comfortable). If tight, add swap as insurance:
  ```bash
  sudo fallocate -l 16G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  ```
- **~10 GB free disk** (HF download ~2.3 GB + ONNX output ~2.3 GB).
- **Python 3.12** (OML4Py 2.1 requires 3.12+).

---

## Deployment checklist (on an x86_64 Linux box)

```bash
# 0. Get the repo + a populated .env (ORACLE_* values) and the ADB wallet on disk.

# 1. Create a venv and install the dependency stack.
python3.12 -m venv ~/oml-venv
~/oml-venv/bin/pip install --upgrade pip
~/oml-venv/bin/pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
~/oml-venv/bin/pip install -r webapp/server/corpus/onnx/requirements.txt

# 2. Download the OML4Py 2.1 CLIENT wheel (NOT on PyPI — license click-through):
#      https://www.oracle.com/database/technologies/oml4py-downloads.html
#    Choose the Linux x86_64 client, unzip, then install the cp312 wheel:
~/oml-venv/bin/pip install /path/to/oml-2.1.1-cp312-cp312-linux_x86_64.whl

# 3. Smoke-test the DB connection (uses only oracledb; safe, read-only).
cd webapp/server/corpus/onnx
~/oml-venv/bin/python convert_bge_m3_26ai.py --check
#   → "[check] ✅ connected — Oracle AI Database 26ai ..."

# 4. Convert bge-m3 and load it straight into the ADB (one step).
~/oml-venv/bin/python convert_bge_m3_26ai.py
#   downloads ~2.3 GB, augments, export2db('BGE_M3_MODEL')
```

### Verify in SQL (Database Actions → SQL Worksheet, as the corpus user)

```sql
SELECT model_name, mining_function
  FROM user_mining_models WHERE mining_function = 'EMBEDDING';

-- Should return a 1024-dim vector:
SELECT VECTOR_EMBEDDING(BGE_M3_MODEL USING '你好世界 hello world' AS DATA) FROM DUAL;
```

### Flip the app to in-DB embeddings

In `.env`:
```ini
EMBEDDING_PROVIDER=database
DB_EMBED_MODEL=BGE_M3_MODEL      # must match the model_name loaded above
```
The dispatch is already wired: `webapp/server/corpus/oci/genai.ts` →
`embedTextsInDb()` runs `SELECT VECTOR_EMBEDDING(BGE_M3_MODEL USING :txt AS DATA)`.

### Re-embed existing chunks

bge-m3 vectors differ from the previous provider's, so existing rows must be
re-embedded for search to stay coherent. Either:

```sql
-- in SQL (bulk, then rebuild the vector index) — see load_model.sql step 5
UPDATE artifact_chunks SET embedding = VECTOR_EMBEDDING(BGE_M3_MODEL USING text AS DATA);
COMMIT;
ALTER INDEX ix_chunks_vec REBUILD;
```
or run the app's tool: `npx tsx webapp/server/corpus/reembed.ts`.

---

## Fallback: convert on x86, load from anywhere (bucket route)

If you'd rather not run `export2db` directly from the x86 box (e.g. it can't
reach the ADB), produce the file and load via Object Storage:

```bash
~/oml-venv/bin/python convert_bge_m3_26ai.py --file   # → onnx_output/bge_m3_model.onnx
# upload to your OCI bucket (oci CLI or webapp/server/corpus/oci/storage.ts),
# then run load_model.sql's LOAD_ONNX_MODEL_CLOUD step from any client (incl. ARM).
```

---

## Notes

- Connection is verified working from this repo's `.env` via python-oracledb
  thin mode (mirrors `oci/db.ts`): wallet dir + wallet password + dsn alias.
  `--check` exercises exactly that and needs no OML4Py, so it runs on ARM too.
- Quantization (INT8) is optional on 26ai since the size cap is gone; enable it
  via `ONNXPipelineConfig` if you want a smaller/faster model that caches better
  in DB shared memory (Oracle recommends it for models > 400 MB).
- See also the project memory note `in-db-onnx-blocked-on-arm` for the decision
  history.
```
