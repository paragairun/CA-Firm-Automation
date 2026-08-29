// Persists pending sync jobs to disk so a sync that completes locally but
// fails to upload survives a process restart or network outage (spec
// §8.3). The spec calls for SQLite specifically; this uses a flat JSON
// file instead — SQLite in Node means a native binding (better-sqlite3),
// which complicates `npm install` working out of the box across
// platforms without a build toolchain. A JSON file gives the same
// durability guarantee for this agent's actual job volume (a handful of
// pending syncs at most); swap for better-sqlite3 if job volume ever
// grows enough that this matters.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AGENT_DIR } from './crypto.js';
import type { SyncJob, LedgerRecord, VoucherRecord } from './types.js';

const QUEUE_PATH = join(AGENT_DIR, 'queue.json');
const MAX_ATTEMPTS = 5;

function readQueue(): SyncJob[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, 'utf8')) as SyncJob[];
  } catch {
    return []; // corrupt queue file — start clean rather than crash the agent
  }
}

function writeQueue(jobs: SyncJob[]): void {
  writeFileSync(QUEUE_PATH, JSON.stringify(jobs, null, 2));
}

export function enqueue(syncConfigId: string, ledgers: LedgerRecord[], vouchers: VoucherRecord[]): SyncJob {
  const job: SyncJob = {
    id: randomUUID(),
    sync_config_id: syncConfigId,
    ledgers,
    vouchers,
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  const jobs = readQueue();
  jobs.push(job);
  writeQueue(jobs);
  return job;
}

export function listPending(): SyncJob[] {
  return readQueue().filter((j) => j.attempts < MAX_ATTEMPTS);
}

export function markSent(jobId: string): void {
  writeQueue(readQueue().filter((j) => j.id !== jobId));
}

export function markFailed(jobId: string, error: string): void {
  const jobs = readQueue();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    job.attempts += 1;
    job.last_error = error;
  }
  writeQueue(jobs);
}
