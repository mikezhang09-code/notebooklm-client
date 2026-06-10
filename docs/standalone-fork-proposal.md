# Proposal: Standalone Fork — SQLite + Local Storage, No NotebookLM

**Status:** proposal (no code changes yet)
**Date:** 2026-06-10

## Goal

Let others replicate this app as a self-contained research-corpus tool:

- **Drop** the NotebookLM integration entirely (no Google session, no artifact generation).
- **Replace** Oracle Autonomous Database 23ai with **SQLite**.
- **Replace** OCI Object Storage with the **local filesystem**.

## Why this is tractable

The repo is really two apps sharing a folder:

1. **NotebookLM client library** — `src/` plus most of the webapp's Express routes,
   which proxy NotebookLM through that library.
2. **Research corpus** — `webapp/server/corpus/` plus the Free Forms / Collections /
   Ask UI in the React client.

The corpus side is already cleanly gated behind `getCorpusConfig()` (the webapp runs
with it disabled), and it only touches Oracle/OCI through **two files**:
`corpus/oci/db.ts` and `corpus/oci/storage.ts`. Swapping the backends is a port,
not a rewrite.

## Resulting product scope

Without NotebookLM the app becomes:

> **Upload files + write markdown notes + tag/organize into collections +
> semantic search + RAG chat with citations.**

This is still a coherent product. Corpus chat talks to Gemini/Mimo directly (not
NotebookLM), and embeddings come from Gemini or Voyage API keys — none of that
depends on Oracle or NotebookLM.

**Lost capabilities** (be explicit with users of the fork):

- "Generate with AI" (audio/report/video/quiz/…): `/api/generate/:kind` creates a
  NotebookLM notebook behind the scenes. Gone.
- Audio/video transcription: powered by OCI Speech (Whisper). Gone unless
  re-implemented later (e.g. local whisper.cpp or an API).
- The "NotebookLM" provenance bucket and notebook browsing pages.

---

## 1. Delete list (NotebookLM layer)

| Path | Why |
|---|---|
| `src/` (entire) | NotebookLM library — transports, RPC, workflows, CLI |
| `bin/` | curl-impersonate binaries (library transport) |
| `scripts/setup-curl.mjs`, `scripts/setup-curl.ts`, `scripts/link-lib.mjs` | Library tooling |
| `tests/` | Library tests |
| `webapp/server/routes/session.ts` | NotebookLM session validation |
| `webapp/server/routes/notebooks.ts` | NotebookLM notebook CRUD |
| `webapp/server/routes/sources.ts` | NotebookLM source management |
| `webapp/server/routes/chat.ts` | NotebookLM chat proxy |
| `webapp/server/routes/generate.ts` | NotebookLM artifact generation |
| `webapp/server/routes/analyze.ts` | NotebookLM analyze flows |
| `webapp/server/routes/files.ts` | Serves generate-job output files |
| `webapp/server/routes/diagnose.ts` | Mostly NotebookLM session diagnostics (port the corpus search-index backfill bits into `corpus.ts` first) |
| `webapp/server/lib/client-factory.ts` | Builds the NotebookLM client |
| `webapp/server/lib/session-header.ts` | Parses `X-NBLM-Session` |
| `webapp/server/lib/job-store.ts`, `webapp/server/lib/sse.ts` | Generate-job plumbing + SSE progress |
| `webapp/server/corpus/notebooks.ts` | Mirrors NotebookLM notebook names for provenance |
| `webapp/server/corpus/oci/genai.ts` | OCI GenAI embeddings (keep Gemini/Voyage instead) |
| `webapp/server/corpus/oci/speech.ts` | OCI Speech transcription |
| `webapp/server/corpus/transcribe.ts`, `transcribe-backfill.ts` | Depend on OCI Speech |
| `webapp/server/corpus/onnx/` | Oracle in-database ONNX embedding model |
| `webapp/client/src/components/SessionGate.tsx` | Session paste flow |
| `webapp/client/src/lib/session-store.ts` | Browser-side session storage |
| `webapp/client/src/pages/nh/NotebookLMPage.tsx`, `NotebookDetailPage.tsx` | Notebook browsing UI |
| `webapp/client/src/components/GenerateDrawer.tsx`, `GenerateStandaloneDrawer.tsx` | Generation UIs |

## 2. Keep list (the actual app)

**Server — corpus core:**

- `webapp/server/corpus/`: `ingest.ts`, `chunk.ts`, `extract/` (PDF/DOCX/HTML/TXT
  parsers), `search.ts`, `tags.ts`, `collections.ts`, `chat.ts`, `chat-history.ts`,
  `ulid.ts`, `config.ts`, `index.ts`, plus whichever debug scripts remain useful
  (`check.ts`, `test-ingest.ts`, `search-test.ts`, `verify-data.ts`)
- `webapp/server/corpus/oci/` → **keep and relocate** (e.g. to `corpus/providers/`):
  `gemini.ts`, `voyage.ts`, `mimo.ts`, `gemini-ocr.ts` — all plain API-key HTTP
  clients with no OCI dependency
- `webapp/server/routes/corpus.ts` — the whole corpus REST API
- `webapp/server/index.ts` — trimmed to mount only `/api/health` + `/api/corpus`
- `webapp/server/lib/handler.ts` — generic error handler

**Client — everything else:**

- `App.tsx`, `AppShell.tsx`, all Free Forms / Collections / Ask / Settings pages
- All drawers/modals: `UploadDrawer`, `CreateFlow`, `EditItemDrawer`, `ItemModal`,
  `ItemCard`, `MarkdownEditor`, `MindmapView`, `Viewer`, `CorpusChat`
- `lib/`: `api.ts`, `registry.ts`, `artifacts.ts`, `collections.ts`,
  `corpus-index.ts`, `markdown*`, `editor-commands.ts`, `theme.ts`, `toast.tsx`

**Client trims (edit, don't delete):**

- `registry.ts` — remove the `generate`/`backendKind`/`GEN_SPEC` machinery (or set
  `generate: false` everywhere as a first pass)
- `CreateFlow.tsx` — drop the "Generate with AI" card; keep Upload + Write a note
- `lib/artifacts.ts` — remove `fetchNotebookMap()` / `resolveFrom()` notebook lookups
- `FreeFormTypePage.tsx`, `FreeFormsOverviewPage.tsx`, filters — drop the
  `notebooklm` provenance bucket (keep `personal` = Collections, `standalone` = Free form)

## 3. Replacement work

### 3.1 `corpus/oci/db.ts` → `corpus/db.ts` (SQLite)

Recommended driver: **`better-sqlite3`** (synchronous, zero-config, fast).

The interface to preserve is `withConnection(cfg, fn)` — roughly 20 callsites across
`routes/corpus.ts`, `ingest.ts`, `collections.ts`, `tags.ts`, `chat-history.ts`,
`search.ts` run raw SQL through it.

Two dialect gotchas that ripple through the codebase:

1. **Uppercase column keys.** node-oracledb returns rows keyed `r.KIND`, `r.TITLE`,
   `r.CREATED_AT` — `routes/corpus.ts` reads them that way everywhere. Cheapest fix:
   make the SQLite wrapper uppercase the keys of every returned row. This avoids
   rewriting hundreds of property accesses.
2. **SQL dialect.** In queries: `FETCH FIRST n ROWS ONLY` → `LIMIT n`,
   `SYSTIMESTAMP` → `datetime('now')`. In `schema.sql`: `VARCHAR2`/`CLOB` → `TEXT`,
   `BLOB` stays `BLOB`, `VECTOR(1024, FLOAT32)` → `BLOB` (Float32 bytes) or a
   `vec0` virtual table (see 3.3), `TIMESTAMP` → `TEXT` (ISO-8601). The `:name`
   bind style survives — better-sqlite3 supports it natively.

Port `schema.sql` + the `schema.alter-*.sql` migrations into one consolidated
SQLite schema; apply it automatically on first open (no separate migration step
for a fresh fork).

### 3.2 `corpus/oci/storage.ts` → `corpus/local-storage.ts` (filesystem)

The module exports a small surface: `putObject`, `getObjectBuffer`, delete, and
presigned-URL helpers. Map to:

- Data dir: `<DATA_DIR>/objects/<objectName>` (objectName already includes a
  ULID-based prefix, so collisions aren't a concern)
- `putObject` → `fs.writeFile` (create parent dirs)
- `getObjectBuffer` → `fs.readFile`
- delete → `fs.unlink`
- **Presigned URLs** → replace with an authenticated Express route that streams
  from disk, e.g. `GET /api/corpus/blob/:artifactId`. Search `routes/corpus.ts`
  for the presign/download spots (around the bucket-column query, ~line 714).

### 3.3 Vector search in `search.ts`

The only genuinely non-mechanical piece: `VECTOR_DISTANCE(embedding, :q, COSINE)`
has no SQLite builtin. Two options:

- **`sqlite-vec` extension (recommended).** A `vec0` virtual table gives real kNN
  with cosine distance; loads into better-sqlite3 with one
  `sqliteVec.load(db)` call. Keeps `search.ts` shape-stable.
- **Brute force in JS (acceptable v1).** Store embeddings as Float32 BLOBs, load
  candidate chunks (after kind/collection filters), compute cosine in a loop.
  Completely fine below ~50k chunks and removes a native dependency.

Keep the post-processing as-is: group hits by artifact, top-N artifacts,
snippets-per-artifact, `maxDistance` threshold.

### 3.4 `corpus/config.ts`

Replace the 12 required OCI/Oracle env vars with:

| Var | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `~/.corpus` | Root for SQLite file + object storage |
| `SQLITE_PATH` | `<DATA_DIR>/corpus.db` | Database file |
| `GEMINI_API_KEY` | — | Embeddings + chat (primary) |
| `VOYAGE_API_KEY` | — | Embeddings (alternative) |
| `MIMO_API_KEY` | — | Chat fallback |
| `EMBEDDING_PROVIDER` | `gemini` | `gemini` \| `voyage` |
| `CHAT_PROVIDER` / `CHAT_FALLBACK_PROVIDERS` | as today | Keep the chain logic |

Drop: all `OCI_*`, all `ORACLE_*`, `EMBEDDING_PROVIDER=oci|database`, all Speech
config, the GenAI-region split. The corpus can now be **always enabled** (SQLite
needs no credentials) — embedding/chat features degrade gracefully when API keys
are missing, same as today.

### 3.5 `package.json`

- **Remove:** `oracledb`, `oci-common`, `oci-objectstorage`, `oci-aispeech` (if
  present), the curl-impersonate postinstall script, `puppeteer`/transport deps,
  and everything pulled in only by `src/`
- **Add:** `better-sqlite3` (+ `sqlite-vec` if chosen)
- Rewrite `scripts` to just: `dev`, `build`, `start` for the webapp

## 4. Suggested order of attack

1. **Fork and amputate.** Delete the NotebookLM layer (section 1), trim
   `webapp/server/index.ts` to the corpus router, get the server compiling with
   the corpus disabled.
2. **Port the database.** Write `db.ts` (better-sqlite3 + uppercase-keys wrapper),
   consolidate the schema, fix dialect issues in queries as type errors/tests
   surface them.
3. **Port storage.** `local-storage.ts` + the blob-streaming route replacing
   presigned URLs.
4. **Port search.** sqlite-vec or JS cosine.
5. **Trim the client.** Remove session gate, notebook pages, generate flows, and
   the `notebooklm` provenance bucket; verify upload → search → chat end-to-end.

The embedding/chat provider chain (Gemini → Mimo fallback) carries over untouched —
that is what keeps this a port rather than a rewrite.
