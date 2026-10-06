import { CONNECTION_TYPES } from '../connectors/registry';
import { isRecord } from '../connectors/values';
import { firstTurns } from '../model/turns';
import type { ObjectStore } from './store';

// Fixed, so every device, and every read of an old backup, upgrades one connection to the same value: a restore
// carried on after a stop compares what it wrote with the backup's copy.
const ACCOUNT = 'account-1';
const GROUP = 'group-1';

// Every decrypted value and every backup line passes here before anything reads it. null for a value already current.
// A connection saved before pools held one secret, and the name of who signed in.
export function upgradeValue(kind: string, value: unknown): Record<string, unknown> | null {
  if (kind !== 'connection' || !isRecord(value) || typeof value.secret !== 'string' || 'accounts' in value) return null;
  const { secret, account, ...rest } = value;
  const pool = CONNECTION_TYPES.some((type) => type.id === rest.type && type.pool);
  return { ...rest, accounts: [{ id: ACCOUNT, secret, ...(typeof account === 'string' && { name: account }) }], turns: pool ? firstTurns(GROUP, ACCOUNT) : null };
}

// The stored copies of what the store upgraded as it read them, written back once, so the old shape leaves the
// account. Each is written as it is held then, so a change another device made meanwhile is kept.
export async function saveUpgraded(store: ObjectStore): Promise<void> {
  await Promise.all(store.takeUpgraded().map((id) => store.update('connection', id, (current) => current)));
}
