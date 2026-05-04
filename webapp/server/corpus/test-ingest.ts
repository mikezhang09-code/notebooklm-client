/**
 * End-to-end ingest smoke test.
 *
 *   npx tsx server/corpus/test-ingest.ts [path-to-file] [kind] [title]
 *
 * With no arguments, creates a synthetic text blob in-memory and ingests it.
 * With a path, reads the file from disk and ingests it with MIME auto-detected
 * from the extension.
 *
 * Exits 0 on success, prints the artifact id + chunk count + preview.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ingestArtifact, type ArtifactKind } from './ingest.js';
import { closeDbPool } from './oci/db.js';

const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
};

function synthBuffer(): { buffer: Buffer; filename: string; mime: string; title: string } {
  const text = [
    'M2 smoke test document.',
    '',
    'This is a multilingual test. 这是一个双语测试文档,',
    '用于验证 OCI Generative AI 的 cohere embed multilingual v3 模型',
    'can embed both English and Chinese chunks correctly.',
    '',
    'Paragraph 2: research corpus architecture.',
    'Oracle Autonomous Database 23ai/26ai provides native VECTOR(1024) column',
    'support with HNSW in-memory neighbor-graph indexes for fast cosine kNN.',
    'Object Storage holds the raw blob; metadata + chunks + embeddings live in ADB.',
    '',
    'Paragraph 3: why this works well for NotebookLM artifacts.',
    'Audio podcasts, reports, quizzes, and user uploads all flow through a single',
    'ingestion pipeline: extract text → chunk → embed → insert with transactional',
    'semantics so partial writes never leave the catalog inconsistent.',
  ].join('\n');
  return {
    buffer: Buffer.from(text, 'utf8'),
    filename: 'm2-smoke-test.txt',
    mime: 'text/plain',
    title: 'M2 smoke test — multilingual paragraphs',
  };
}

async function main(): Promise<number> {
  const [, , filePath, kindArg, titleArg] = process.argv;

  let buffer: Buffer;
  let filename: string;
  let mime: string;
  let title: string;

  if (filePath) {
    buffer = await readFile(filePath);
    filename = basename(filePath);
    mime = EXT_TO_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    title = titleArg ?? filename;
  } else {
    const s = synthBuffer();
    buffer = s.buffer;
    filename = s.filename;
    mime = s.mime;
    title = s.title;
  }

  const kind: ArtifactKind = (kindArg as ArtifactKind | undefined) ?? 'upload';

  console.log(`→ ingesting ${filename} (${mime}, ${buffer.length} bytes) as kind=${kind}`);
  const start = Date.now();
  const result = await ingestArtifact({
    buffer,
    filename,
    mimeType: mime,
    title,
    kind,
    origin: 'upload',
    tags: ['m2-test'],
    metadata: { source: 'test-ingest.ts' },
  });
  const elapsedMs = Date.now() - start;

  console.log('✓ ingested in', elapsedMs, 'ms');
  console.log(JSON.stringify(result, null, 2));
  await closeDbPool();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error('ingest failed:', err);
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
