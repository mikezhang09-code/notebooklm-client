#!/usr/bin/env node
/**
 * Poll a TCP port until it accepts connections, then exit 0.
 *
 * Used by `npm run dev` to stop Vite from opening a browser before the
 * backend is ready — otherwise the first `/api/*` fetch races the backend's
 * first-compile and fails with ECONNREFUSED.
 *
 * Usage:  node scripts/wait-for-port.mjs <port> [host] [timeoutMs]
 */

import { createConnection } from 'node:net';

const port = Number(process.argv[2]);
const host = process.argv[3] ?? '127.0.0.1';
const timeoutMs = Number(process.argv[4] ?? 60_000);

if (!Number.isFinite(port) || port <= 0) {
  console.error('[wait-for-port] Usage: wait-for-port.mjs <port> [host] [timeoutMs]');
  process.exit(2);
}

const pollMs = 250;
const deadline = Date.now() + timeoutMs;

function probe() {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
    sock.setTimeout(pollMs);
  });
}

process.stdout.write(`[wait-for-port] Waiting for ${host}:${port}`);

while (Date.now() < deadline) {
  // eslint-disable-next-line no-await-in-loop
  if (await probe()) {
    process.stdout.write(' ready.\n');
    process.exit(0);
  }
  process.stdout.write('.');
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, pollMs));
}

process.stdout.write('\n');
console.error(`[wait-for-port] Timed out after ${timeoutMs} ms waiting for ${host}:${port}`);
process.exit(1);
