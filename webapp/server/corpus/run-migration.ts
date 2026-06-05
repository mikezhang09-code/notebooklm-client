/**
 * Idempotent SQL migration runner.
 *
 * Executes a `.sql` file made of `/`-delimited PL/SQL blocks (the same format
 * as schema.sql / schema.alter-*.sql) against the corpus ADB, then prints any
 * trailing verification SELECTs. node-oracledb can't run a multi-statement
 * script directly, so we split on lone `/` lines and run each piece.
 *
 * Usage (from webapp/):
 *   npx tsx server/corpus/run-migration.ts schema.alter-projects.sql
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';
import { getCorpusConfig } from './config.js';
import { withConnection, closeDbPool } from './oci/db.js';

/** Split a script into statements: PL/SQL blocks end at a lone `/`; plain SQL ends at `;`. */
function splitStatements(sql: string): string[] {
  const lines = sql.split(/\r?\n/);
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push(text);
    buf = [];
  };
  for (const line of lines) {
    if (line.trim() === '/') {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Strip SQL line comments + blanks; true if nothing executable remains. */
function isCommentOnly(stmt: string): boolean {
  return stmt
    .split(/\r?\n/)
    .every((l) => l.trim() === '' || l.trim().startsWith('--'));
}

async function main(): Promise<number> {
  const fileArg = process.argv[2] ?? 'schema.alter-projects.sql';
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, fileArg);
  const sql = readFileSync(path, 'utf8');

  const cfg = await getCorpusConfig();
  if (!cfg) {
    console.error('Corpus disabled (missing env). Nothing to run.');
    return 1;
  }

  const segments = splitStatements(sql).filter((s) => !isCommentOnly(s));

  await withConnection(cfg, async (conn) => {
    for (const seg of segments) {
      // The trailing verification segment is a set of `;`-separated SELECTs.
      // Everything else is a single PL/SQL block.
      const isPlsql = /\b(DECLARE|BEGIN)\b/i.test(seg) || /^\s*(CREATE|ALTER)\b/i.test(seg);
      if (isPlsql) {
        const label = seg.split('\n').find((l) => l.trim() && !l.trim().startsWith('--'))?.trim().slice(0, 70) ?? '(block)';
        try {
          await conn.execute(seg);
          await conn.commit();
          console.log(`✓ ${label}`);
        } catch (err) {
          console.error(`✗ ${label}\n   ${(err as Error).message}`);
          throw err;
        }
      } else {
        // Verification SELECTs.
        for (const raw of seg.split(';')) {
          const q = raw.trim();
          if (!q || isCommentOnly(q) || !/^select/i.test(q.replace(/^\s*(--.*\n)+/gm, '').trim())) continue;
          const r = await conn.execute(q, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
          console.log(`\n— ${q.replace(/\s+/g, ' ').slice(0, 80)}…`);
          console.table(r.rows);
        }
      }
    }
  });

  await closeDbPool();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('migration failed:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
