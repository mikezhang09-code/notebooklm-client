#!/usr/bin/env node
/**
 * Sync the root `notebooklm-client` dist/ into `node_modules/notebooklm-client/`.
 *
 * Needed because npm workspaces on Windows often *copies* instead of
 * symlinking the local workspace package. When the library is rebuilt, the
 * copy in `node_modules/` can become stale and the webapp sees outdated types
 * and runtime code.
 *
 * This script is idempotent; it overwrites the nested dist/ and package.json
 * from the source of truth at the repo root.
 */

import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webappRoot = resolve(__dirname, '..');
const repoRoot = resolve(webappRoot, '..');
const target = resolve(repoRoot, 'node_modules', 'notebooklm-client');
const targetDist = resolve(target, 'dist');
const sourceDist = resolve(repoRoot, 'dist');
const sourcePkg = resolve(repoRoot, 'package.json');

if (!existsSync(sourceDist)) {
  console.error(
    `[link-lib] ${sourceDist} does not exist. Run \`npm run build\` in the repo root first.`,
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });
if (existsSync(targetDist)) rmSync(targetDist, { recursive: true, force: true });
cpSync(sourceDist, targetDist, { recursive: true });
copyFileSync(sourcePkg, resolve(target, 'package.json'));

// Copy the prebuilt curl-impersonate binary if present so the library can
// find it at the expected bin/ path relative to its own location.
const sourceBin = resolve(repoRoot, 'bin');
if (existsSync(sourceBin)) {
  const targetBin = resolve(target, 'bin');
  if (existsSync(targetBin)) rmSync(targetBin, { recursive: true, force: true });
  cpSync(sourceBin, targetBin, { recursive: true });
}

console.log(`[link-lib] Synced notebooklm-client → ${target}`);
