# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Library
npm run build           # compile TypeScript → dist/
npm run dev -- <args>   # run CLI without compiling (uses tsx)
npm test                # unit/integration tests (Vitest, concurrent)
npm run test:e2e        # E2E tests against real NotebookLM (sequential, needs auth)

# Webapp
npm run webapp:dev      # Vite :5173 + Express :7860 with hot reload
npm run webapp:build    # build library + webapp
npm run webapp:start    # serve production bundle on :7860

# Type-check (no emit)
npx tsc --noEmit

# Corpus debug scripts (run from webapp/)
npx tsx server/corpus/check.ts
npx tsx server/corpus/test-ingest.ts [path kind title]
npx tsx server/corpus/search-test.ts "query"
npx tsx server/corpus/transcribe-backfill.ts [--apply]
```

On Windows, use `npm install --ignore-scripts` to skip the optional `curl-impersonate` postinstall.

## Architecture

### Transport layer (`src/transport*.ts`)

Four pluggable `Transport` implementations, resolved automatically:

| Transport | Fingerprint | Availability |
|-----------|------------|--------------|
| `BrowserTransport` | 100% (real Chrome via Puppeteer) | all platforms, heavyweight |
| `CurlTransport` | 100% (curl-impersonate + BoringSSL) | macOS/Linux only |
| `TlsClientTransport` | ~99% (Go uTLS via FFI) | all platforms |
| `HttpTransport` | ~40% (undici with Chrome TLS config) | always available, fallback |

`transport-resolver.ts` selects or auto-chains them. The `--transport` CLI flag (and `transport` option in the library API) overrides resolution.

### RPC layer (`src/api.ts`)

Stateless functions that accept a `RpcCaller` (thin wrapper over `Transport.execute`). Each function constructs a batchexecute payload, calls the RPC endpoint, and parses the `]\]\n`-delimited response via `boq-parser.ts` + `parser.ts`. RPC method IDs are hardcoded in `rpc-ids.ts` and can be refreshed at runtime via `rpc-config.ts`.

### Workflow layer (`src/workflows.ts`)

Orchestrates the full artifact lifecycle: create notebook → add source → generate artifact → poll until ready → download → (optional) ingest into corpus. Emits SSE progress events for the webapp. All `run*()` functions live here.

### CLI layer (`src/cli.ts`)

Commander.js with 14+ subcommands. Global options: `--transport`, `--home`, `--proxy`, `--headless`. Source options: `--url`, `--text`, `--file`, `--topic` (with `--research-mode fast|deep`).

### Session management (`src/session-store.ts`)

Loads/saves `~/.notebooklm/session.json` (or `--home`-specified dir). Token refresh is automatic and debounced via `refresh-guard.ts`. The `export-session` command re-authenticates if expired.

### Webapp (`webapp/`)

- **Frontend:** Vite + React + React Router + Tailwind. Pages: Library, Generate, Analyze, Chat, Session, Diagnose.
- **Backend:** Express + SSE streaming. Routes live in `webapp/server/routes/`.
- **Auth model:** Bring-your-own-session — user pastes `session.json` once; stored in browser `localStorage`, sent as `X-NBLM-Session` header. Server never persists it.
- **Job files:** Written to `os.tmpdir()/nblm-jobs/<jobId>`, served via `/api/files/<jobId>/<filename>`, TTL 30 min (override: `NBLM_JOB_TTL_MS`).

### Research corpus (`webapp/server/corpus/`) — optional

Oracle ADB 23ai + OCI Object Storage + OCI GenAI. Enabled only when OCI env vars are set; the webapp runs without them. Pipeline: extract text → chunk (800 chars, 100-char overlap, sentence-aware) → embed via `cohere.embed-multilingual-v3.0` (1024-dim) → store in ADB + Object Storage.

Key files: `search.ts` (kNN via `VECTOR_DISTANCE … COSINE`), `chunk.ts`, `extract/` (PDF/DOCX/HTML/TXT parsers), `oci/` (DB + storage clients). Connection uses node-oracledb 6.x Thin mode (mTLS wallet, no Instant Client).

**OCI region split:** `OCI_REGION` = DB + Storage region; `OCI_GENAI_REGION` = GenAI region (use a region that hosts GenAI, e.g. `ap-osaka-1`, if your home region doesn't).

## Key enums & options

**Artifact types:** `audio`, `report`, `video`, `quiz`, `flashcards`, `infographic`, `slides`, `data_table`

**Audio:** format `deep_dive|brief|critique|debate`, length `short|default|long`

**Report:** template `briefing_doc|study_guide|blog_post|custom`

**Video:** format `explainer|brief|cinematic`, style `auto|classic|whiteboard|kawaii|anime|watercolor|retro_print`

**Infographic:** orientation `landscape|portrait|square`, detail `concise|standard|detailed`, style `sketch_note|professional|bento_grid`

## Tests

Unit/integration tests run concurrently under Vitest (`vitest.config.ts`). E2E tests use a separate config (`vitest.config.e2e.ts`), run sequentially (`--no-file-parallelism`), share real notebook state across tests, and require a valid `session.json`. Test timeouts: 120s per test, 60s for hooks.

## Multi-account

Pass `--home ~/.notebooklm-work` or set `NOTEBOOKLM_HOME` to isolate session files per account.
