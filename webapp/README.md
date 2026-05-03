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

## Notes / caveats

- Long generations (audio, video, slides) can take several minutes. Keep the
  browser tab open — progress streams over SSE.
- The server writes each job's artefacts into `os.tmpdir()/nblm-jobs/<jobId>`
  and serves them through `/api/files/<jobId>/<filename>`. Files expire after
  30 minutes (configurable via `NBLM_JOB_TTL_MS`).
- No interactive Google login from the hosted UI. If your session expires,
  run `export-session` again locally and re-paste.
- Works with any free or Plus NotebookLM account; quotas apply as usual.
