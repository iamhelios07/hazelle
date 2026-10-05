import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../http';
import { COPIED, generationsDir, listGenerations, MANIFEST } from './generation';

// How fresh the off-site backup is and how full the disk, and the warnings both raise. The admin screen and the alert
// webhook read the warnings from here; nothing else decides them.

const HOUR_MS = 60 * 60 * 1000;
const STALE_HOURS = 36;
const MIN_FREE_PERCENT = 20;

export type Warning = 'backup-stale' | 'disk-full';
// backupAgeHours: since the newest complete generation was captured, null when none is. diskFreePercent: the lowest
// among the data directory and files/, which may be a filesystem of its own.
export type Freshness = { backupAgeHours: number | null; diskFreePercent: number; warnings: Warning[] };

async function freePercent(path: string): Promise<number> {
  const { bavail, blocks } = await statfs(path);
  return Math.floor((bavail / blocks) * 1000) / 10;
}

export async function freshness(env: Services, dataDir: string, now: number): Promise<Freshness> {
  const complete = (await listGenerations(dataDir))
    .filter(({ id }) => existsSync(join(generationsDir(dataDir), id, MANIFEST)) && existsSync(join(generationsDir(dataDir), id, COPIED)))
    .map(({ capturedAt }) => capturedAt);
  const backupAgeHours = complete.length ? Math.floor(((now - Math.max(...complete)) / HOUR_MS) * 10) / 10 : null;
  const files = join(dataDir, 'files');
  const diskFreePercent = Math.min(await freePercent(dataDir), ...(existsSync(files) ? [await freePercent(files)] : []));
  // With no complete generation yet, the installation's own age is how long it has gone without one.
  const unbackedHours =
    backupAgeHours ?? (now - (await env.db.prepare('SELECT created_at FROM installation').first<number>('created_at'))!) / HOUR_MS;
  const warnings: Warning[] = [];
  if (unbackedHours > STALE_HOURS) warnings.push('backup-stale');
  if (diskFreePercent < MIN_FREE_PERCENT) warnings.push('disk-full');
  return { backupAgeHours, diskFreePercent, warnings };
}
