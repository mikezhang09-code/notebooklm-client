/**
 * notebooklm-webapp — Express server entrypoint.
 *
 * Serves the built React client + REST/SSE API on a single port.
 * Every user supplies their own NotebookLM session via the X-NBLM-Session
 * header (base64-encoded JSON); the server is fully stateless w.r.t. creds.
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { sessionRouter } from './routes/session.js';
import { notebooksRouter } from './routes/notebooks.js';
import { sourcesRouter } from './routes/sources.js';
import { filesRouter } from './routes/files.js';
import { diagnoseRouter } from './routes/diagnose.js';
import { chatRouter } from './routes/chat.js';
import { generateRouter } from './routes/generate.js';
import { analyzeRouter } from './routes/analyze.js';
import { corpusRouter } from './routes/corpus.js';
import { errorHandler } from './lib/handler.js';

const PORT = Number(process.env['PORT'] ?? 7860);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// Optional request logging in dev.
if (process.env['NODE_ENV'] !== 'production') {
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    }
    next();
  });
}

// ── API ──
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0' });
});

app.use('/api/session', sessionRouter);
app.use('/api/notebooks', notebooksRouter);
app.use('/api/notebooks/:id/sources', sourcesRouter);
app.use('/api/files', filesRouter);
app.use('/api/diagnose', diagnoseRouter);
app.use('/api/chat', chatRouter);
app.use('/api/generate', generateRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/corpus', corpusRouter);

app.use(errorHandler);

// ── Static client ──
// In production the client is pre-built into webapp/dist/client.
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  // When running from dist/server/ after `tsc`.
  resolve(here, '..', 'client'),
  // When running from source via tsx.
  resolve(here, '..', 'dist', 'client'),
];
const clientDir = candidates.find((d) => existsSync(d) && statSync(d).isDirectory());

if (clientDir) {
  app.use(express.static(clientDir, { index: 'index.html' }));
  // SPA fallback — serve index.html for non-API GETs.
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    const indexFile = join(clientDir, 'index.html');
    if (!existsSync(indexFile)) return next();
    res.sendFile(indexFile);
    return;
  });
  console.log(`Serving static client from ${clientDir}`);
} else {
  console.log('No built client found — API-only mode (use `vite` dev server on :5173).');
}

app.listen(PORT, HOST, () => {
  console.log(`notebooklm-webapp listening on http://${HOST}:${PORT}`);
});
