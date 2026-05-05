---
title: NotebookLM GUI
emoji: 📓
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# NotebookLM GUI (notebooklm-webapp)

A web GUI that wraps every command in [`notebooklm-client`](https://github.com/icebear0828/notebooklm-client)
— audio podcasts, reports, videos, quizzes, flashcards, infographics, slides,
data tables, analyze, chat, notebook/source management, and diagnostics —
behind friendly forms.

## How auth works (bring-your-own-session)

Interactive Google login **cannot** run on a public server. Instead:

1. On your own machine, log in once:
   ```bash
   npx notebooklm-client export-session
   ```
   This opens Chrome, you sign in, and a `session.json` file is written to
   `~/.notebooklm/session.json`.
2. Open the GUI, paste or upload the `session.json` contents, click
   **Verify & save**. The session is stored **only in your browser's
   `localStorage`** and sent with each request via an `X-NBLM-Session`
   header. The server never persists it.

## Running locally

```bash
# one-time, from the repo root
npm install --ignore-scripts   # on Windows; omit --ignore-scripts elsewhere
npm run build                  # build the library

# dev (Vite on :5173 + Express on :7860)
npm run webapp:dev

# production build + serve
npm run webapp:build
npm run webapp:start
# open http://localhost:7860
```

## Running as a Docker image / HF Space

```bash
docker build -f Dockerfile.webapp -t notebooklm-gui .
docker run --rm -p 7860:7860 notebooklm-gui
# open http://localhost:7860
```

For Hugging Face Spaces, create a new Space with SDK **Docker** and point it
at the repo; the frontmatter at the top of this file configures the port and
cosmetic metadata.

## Layout

```
webapp/
  server/          Express API + SSE streaming
    routes/
    lib/
  client/          Vite + React + Tailwind + React Router
    src/
      components/  SessionGate, SourceInput, ProgressLog
      pages/       Library / Generate / Analyze / Chat / Session / Diagnose
  scripts/
    link-lib.mjs   Windows-friendly workspace resolver
  Dockerfile      (see repo root: Dockerfile.webapp)
```

## Research corpus (Oracle ADB + Object Storage) — optional

The webapp can optionally persist every artifact you generate (and any document
you upload) to a personal research corpus backed by:

- **Oracle Autonomous Database 23ai/26ai** — metadata + 1024-dim `VECTOR` chunks
- **OCI Object Storage** — blob payloads
- **OCI Generative AI** (`cohere.embed-multilingual-v3.0`) — embeddings for
  semantic search across the whole corpus (English + Chinese + 100+ langs)

The subsystem is **fully optional**: if no env vars are set, the webapp
runs exactly as before and none of the OCI SDKs are reached. Set them and
a **Research** section appears in the sidebar with four pages:

- **Search** (`/corpus`) — semantic search over every ingested chunk with
  per-snippet distance scores, kind + threshold filters, detail panel
  that mints a fresh download PAR and a shareable link.
- **Chat** (`/corpus/chat`) — retrieval-augmented chat. The model is
  given the top-N matching snippets as `documents` and emits inline
  citations that link the answer back to the source artifacts. Gated
  on the optional `OCI_GENAI_CHAT_MODEL` env var (e.g.
  `cohere.command-r-plus-08-2024`); leave it unset to hide the page.
- **Library** (`/corpus/library`) — paginated table of every artifact
  with kind / origin / title filters, row selection for bulk delete,
  inline rename + retag, per-row delete, and a cross-link badge that
  jumps back to the originating NotebookLM notebook when applicable.
- **Upload** (`/corpus/upload`) — drag-and-drop ingest for any document
  (PDF, DOCX, HTML, MD, TXT, CSV, JSON). Auto-fills the title from the
  filename and lets you pick kind + tags before submitting.

In addition, every artifact you **download** from the notebook detail
page is automatically ingested into the corpus in the background — the
row shows a small `✓ Saved to research corpus` badge once indexing
completes. Ingesting the same NotebookLM artifact twice is a no-op
thanks to a `(notebook_id, artifact_id)` unique index.

### Setup (one-time)

1. Provision the OCI bits (compartment, IAM user, group, policy, bucket,
   ADB, GenAI). The walkthrough lives in `progress` notes during dev — see
   `.windsurf/plans/research-corpus-oracle-b6b4fc.md` for the full checklist.
2. Copy `.env.example` (at the repo root) to `.env` and fill in real values.
   `.env` is gitignored.
3. Run `webapp/server/corpus/schema.sql` via OCI Console → Database Actions
   → SQL, logged in as the **CORPUS** user.
4. Smoke test:
   ```bash
   npm run webapp:dev   # or webapp:start
   curl http://localhost:7860/api/corpus/health
   ```
   You should see `{"enabled": true, "db": {"ok": true}, "storage": {"ok": true}, "genai": {"ok": true, "dimensions": 1024}}`.

If `enabled` is `false`, `db.error` (etc.) will tell you which env var is
missing or which IAM/network call failed.

### Architecture

```
NotebookLM artifact OR uploaded file
  ↓
extract text → chunk (800 chars, 100 overlap, sentence-aware)
  ↓
OCI GenAI embed-multilingual-v3.0  →  1024-dim vectors
  ↓
ADB tables:  artifacts (catalog) + artifact_chunks (text + VECTOR)
Object Storage:  the original blob bytes
  ↓
Search: SQL `VECTOR_DISTANCE(... COSINE)` over `artifact_chunks` joined
back to `artifacts`, with optional `kind` / date / tag filters.
Download: short-lived OCI pre-authenticated request (PAR) URL, 1h TTL.
```

Connection mode: **node-oracledb 6.x Thin mode** with mTLS via the wallet
files — **no Oracle Instant Client install required**.

Note: many OCI regions (e.g. **Tokyo** `ap-tokyo-1`) don't host Generative
AI. In that case leave `OCI_REGION` at your home region for DB + Storage
co-location and set `OCI_GENAI_REGION=ap-osaka-1` (or another
[GenAI-available region](https://docs.oracle.com/en-us/iaas/Content/generative-ai/regions.htm))
so the embedding client cross-regions automatically. Your tenancy must
be subscribed to the target region; IAM propagation to a newly subscribed
region can take 1–5 minutes.

### Endpoints

```
GET    /api/corpus/health                       subsystem status (db + storage + genai)

POST   /api/corpus/ingest                       multipart: file + title + kind [+ origin/tags/metadata]
                                                Dedupes on (notebook_id, artifact_id) for NotebookLM rows.

GET    /api/corpus/artifacts                    list; filters: kind, origin, notebookId; paginated
GET    /api/corpus/artifacts/:id                detail + short-lived PAR download URL (1 h TTL)
PATCH  /api/corpus/artifacts/:id                body: { title?, tags? }
DELETE /api/corpus/artifacts/:id                row + chunks + Object Storage blob
POST   /api/corpus/artifacts/:id/share          body: { ttlHours? 1..168 } → { shareUrl, expiresAt }

POST   /api/corpus/search                       body: { query, kind?, notebookId?, candidateLimit?,
                                                         artifactLimit?, snippetsPerArtifact?,
                                                         maxDistance? }
                                                Semantic kNN over embeddings, grouped per artifact.

POST   /api/corpus/chat                         body: { question, history?, kind?, notebookId?,
                                                         maxSources?, snippetsPerSource?, maxDistance? }
                                                Retrieval-augmented chat. Returns
                                                { answer, citations[], sources[], retrievalMs, chatMs, ... }
                                                where each citation maps spans in the answer back to
                                                1-based source indices in `sources`. 503 if
                                                `OCI_GENAI_CHAT_MODEL` is not set.
```

Auto-ingest is also wired into the notebook download route:

```
POST /api/notebooks/:id/artifacts/:artifactId/download
     body: { outputDir?, notebookTitle?, artifactTitle? }
     → { jobId, files, ..., corpus: { status } }
     status ∈ "scheduled" | "disabled" | "skipped_kind" | "no_file"
```

Deeper engineering reference for the chat pipeline:
[`docs/corpus-chat.md`](./docs/corpus-chat.md) — full request lifecycle, SQL,
prompt assembly, citation re-keying, perf / cost knobs, and a file map.

Standalone CLIs (for bootstrapping / debugging, run from `webapp/`):

```bash
npx tsx server/corpus/check.ts                          # health probe
npx tsx server/corpus/test-ingest.ts [path kind title]  # ingest a file
npx tsx server/corpus/verify-data.ts                    # row count + kNN self-test
npx tsx server/corpus/search-test.ts "your query"       # top-5 semantic search
```

## Notes / caveats

- Long generations (audio, video, slides) can take several minutes. Keep the
  browser tab open — progress streams over SSE.
- The server writes each job's artefacts into `os.tmpdir()/nblm-jobs/<jobId>`
  and serves them through `/api/files/<jobId>/<filename>`. Files expire after
  30 minutes (configurable via `NBLM_JOB_TTL_MS`).
- No interactive Google login from the hosted UI. If your session expires,
  run `export-session` again locally and re-paste.
- Works with any free or Plus NotebookLM account; quotas apply as usual.
