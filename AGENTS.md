# Repository Guidelines

## Project Structure & Module Organization

This is a Node 20+ TypeScript repository with a root CLI/library package and a `webapp` workspace. Core client code lives in `src/`; CLI handlers are in `src/commands/`; root tests are in `tests/`. The GUI is under `webapp/`: `webapp/server/` contains the Express API, corpus ingestion/search, and OCI integrations, while `webapp/client/` contains the Vite React app and Tailwind styles. Docs live in `README.md`, `docs/`, `webapp/README.md`, and `webapp/docs/`.

## Build, Test, and Development Commands

- `npm install`: install root and workspace dependencies.
- `npm run build`: compile the root TypeScript library to `dist/`.
- `npm run dev -- <args>`: run the CLI from `src/cli.ts` through `tsx`.
- `npm test`: run the root Vitest suite.
- `npm run test:e2e`: run end-to-end tests with `vitest.e2e.config.ts`.
- `npm run webapp:dev`: link the local library, start Express on `:7860`, and start Vite on `:5173`.
- `npm run webapp:build`: build the library, web client, and web server.
- `npm --workspace webapp run typecheck`: typecheck web server and client projects.

## Coding Style & Naming Conventions

Use TypeScript ES modules and strict typing. The root `tsconfig.json` enables `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, and unused checks, so handle optional values explicitly. Follow existing naming: kebab-case modules such as `transport-http.ts`, route files named by resource, and tests named `*.test.ts`. Use two-space indentation.

## Testing Guidelines

Vitest is the test framework. Place root package tests in `tests/` and web/server-focused tests near the relevant module when that pattern already exists, for example `webapp/server/corpus/tags.test.ts`. Run `npm test` before library changes, `npm run test:e2e` for transport or NotebookLM workflow changes, and `npm --workspace webapp run typecheck` for webapp edits.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit-style prefixes with scopes, for example `feat(corpus): ...`, `fix(corpus): ...`, and `docs(corpus): ...`. Keep subjects imperative and specific. Pull requests should describe the user-facing change, list validation commands, link related issues, and include screenshots or short recordings for visible UI changes.

## Security & Configuration Tips

Do not commit session files, `.env`, OCI wallets, API keys, or generated artifacts containing private data. The webapp passes NotebookLM session data through the `X-NBLM-Session` header; keep that data local. Optional corpus features depend on OCI/ADB/Object Storage and provider credentials, so document new environment variables when adding them.
