import { CONNECTION_TYPES } from '../connectors/registry';
import { isRecord } from '../connectors/values';
import { firstTurns } from '../model/turns';
import type { ObjectStore } from './store';

// Fixed, so every device, and every read of an old backup, upgrades one connection to the same value: a restore
// carried on after a stop compares what it wrote with the backup's copy.
const ACCOUNT = 'account-1';
const GROUP = 'group-1';

// The kinds upgradeValue upgrades, and so the only ones the store holds as upgraded.
type Upgraded = 'connection' | 'character' | 'memory';

// Every decrypted value and every backup line passes here before anything reads it. null for a value already current.
export function upgradeValue(kind: string, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (kind === 'connection') return upgradeConnection(value);
  if (kind === 'character') return upgradeCharacter(value);
  if (kind === 'memory') return upgradeMemory(value);
  return null;
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

// Until 2026-10-08 a chat's memory held no chapters.
function upgradeMemory(value: Record<string, unknown>) {
  return 'chapters' in value ? null : { ...value, chapters: [] };
}

// The stored copies of what the store upgraded as it read them, written back once, so the old shape leaves the
// account. Each is written as it is held then, so a change another device made meanwhile is kept. A chat's memory
// read after this ran is written back by its next change.
export async function saveUpgraded(store: ObjectStore): Promise<void> {
  await Promise.all(store.takeUpgraded().map(({ id, kind }) => store.update(kind as Upgraded, id, (current) => current)));
}
