/**
 * Per-job temp-directory allocator + download registry.
 *
 * Each long-running workflow writes its artefacts into a private temp dir
 * under `os.tmpdir()/nblm-jobs/<jobId>/`. We track the jobId → dir mapping
 * so that the `/api/files/:jobId/:filename` endpoint can stream the file
 * back to the user. Jobs expire on a TTL (default 30 min) and are removed
 * from disk + registry by a periodic reaper.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface Job {
  id: string;
  dir: string;
  createdAt: number;
  expiresAt: number;
}

const TTL_MS = Number(process.env['NBLM_JOB_TTL_MS'] ?? 30 * 60_000);
const REAPER_INTERVAL_MS = 5 * 60_000;

const jobs = new Map<string, Job>();

function newJobId(): string {
  return randomBytes(9).toString('base64url');
}

export async function createJob(): Promise<Job> {
  const id = newJobId();
  const dir = join(tmpdir(), 'nblm-jobs', id);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const job: Job = { id, dir, createdAt: now, expiresAt: now + TTL_MS };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (Date.now() > job.expiresAt) {
    void reapJob(id);
    return undefined;
  }
  return job;
}

async function reapJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  try {
    await rm(job.dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function reapAll(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now > job.expiresAt) void reapJob(id);
  }
}

setInterval(reapAll, REAPER_INTERVAL_MS).unref();
