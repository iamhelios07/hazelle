import { CONNECTION_TYPES } from '../connectors/registry';
import { isRecord } from '../connectors/values';
import { KINDS, isValue, type Kind, type Stored } from '../model/kinds';
import { firstTurns } from '../model/turns';
import type { ObjectStore } from './store';

// Fixed, so every device, and every read of an old backup, upgrades one connection to the same value: a restore
// carried on after a stop compares what it wrote with the backup's copy.
const ACCOUNT = 'account-1';
const GROUP = 'group-1';

// Every decrypted value and every backup line passes here before anything reads it. null for a value already current.
export function upgradeValue(kind: string, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (kind === 'connection') return upgradeConnection(value);
  if (kind === 'character') return upgradeCharacter(value);
  return null;
}

// A row from outside, a backup's line or a chat file's, upgraded and checked; null for one that is not a stored object.
export function readRow(line: unknown): Stored<Kind> | null {
  if (!isRecord(line) || typeof line.kind !== 'string' || !Object.hasOwn(KINDS, line.kind)) return null;
  const value = upgradeValue(line.kind, line.value) ?? line.value;
  const { id, parent, rev } = line;
  if (typeof id !== 'string' || (parent !== null && typeof parent !== 'string') || typeof rev !== 'number' || !Number.isFinite(rev) || !isValue(line.kind as Kind, value)) return null;
  return { ...line, id, kind: line.kind as Kind, parent, rev, value };
}

// A connection saved before pools held one secret, and the name of who signed in.
function upgradeConnection(value: Record<string, unknown>) {
  if (typeof value.secret !== 'string' || 'accounts' in value) return null;
  const { secret, account, ...rest } = value;
  const pool = CONNECTION_TYPES.some((type) => type.id === rest.type && type.pool);
  return { ...rest, accounts: [{ id: ACCOUNT, secret, ...(typeof account === 'string' && { name: account }) }], turns: pool ? firstTurns(GROUP, ACCOUNT) : null };
}

// Until 2026-10-07 only greetings were translated on the character, in greetingTranslations by greeting.
function upgradeCharacter(value: Record<string, unknown>) {
  if (!Array.isArray(value.greetingTranslations)) return null;
  const { greetingTranslations, ...rest } = value;
  return { ...rest, translations: greetingTranslations.map(({ greeting, ...each }: { greeting: string }) => ({ source: greeting, ...each })) };
}

// The stored copies of what the store upgraded as it read them, written back once, so the old shape leaves the
// account. Each is written as it is held then, so a change another device made meanwhile is kept.
export async function saveUpgraded(store: ObjectStore): Promise<void> {
  // upgradeValue upgrades these two kinds only.
  await Promise.all(store.takeUpgraded().map(({ id, kind }) => (kind === 'character' ? store.update('character', id, (current) => current) : store.update('connection', id, (current) => current))));
}
