import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_MS } from '../db/account-db';
import { fsyncPath, makeDirs } from '../db/durable';
import { DAY_MS } from '../http';

// departures.json in the backup directory, beside the generations: the accounts that left (탈퇴 or the operator's
// deletion) while a generation from before they left may still be restored. It lives outside the service database,
// which a disaster restore rolls back, and restore.ts deletes each one again. deploy/rclone-backup.sh copies it off-site
// on every pass, and scripts/restore.sh fetch brings it beside the generation. Every read and write is synchronous, so
// writers in one process never interleave.

export const DEPARTURES = 'departures.json';

export type Departure = { account: string; incarnation: string; leftAt: number };

const isDeparture = (value: unknown): value is Departure => {
  const entry = value as Partial<Departure> | null;
  return typeof entry === 'object' && entry !== null && typeof entry.account === 'string' && typeof entry.incarnation === 'string' && Number.isSafeInteger(entry.leftAt);
};

// Null when the file is absent.
export function readDepartures(path: string): Departure[] | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let list: unknown = null;
  try {
    list = JSON.parse(text);
  } catch {
    // Reported below with the file's path.
  }
  if (!Array.isArray(list) || !list.every(isDeparture)) throw new Error(`${path} is not a list of departures`);
  return list;
}

export function writeDepartures(dir: string, list: Departure[]): void {
  makeDirs(dir);
  const temp = join(dir, `.tmp-${DEPARTURES}`);
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, JSON.stringify(list));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, join(dir, DEPARTURES));
  fsyncPath(dir);
}

const departures = (dir: string) => readDepartures(join(dir, DEPARTURES)) ?? [];

export function recordDeparture(dir: string, departure: Departure): void {
  const list = departures(dir);
  if (list.some(({ incarnation }) => incarnation === departure.incarnation)) return;
  writeDepartures(dir, [...list, departure]);
}

// Run with every capture (generation.ts), so a generation always has the file beside it and a restore can tell a
// missing one from an empty one. A generation from before a departure goes at RETENTION_MS from its capture, by the
// daily job: a day later none that holds the account remains.
export function expireDepartures(dir: string, now: number): void {
  writeDepartures(dir, departures(dir).filter(({ leftAt }) => leftAt > now - RETENTION_MS - DAY_MS));
}
