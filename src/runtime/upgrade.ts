import { CONNECTION_TYPES } from '../connectors/registry';
import { isRecord } from '../connectors/values';
import { stampIds } from '../engine/import/convert';
import { without } from '../model/fields';
import { KINDS, isValue, type Kind, type Stored } from '../model/kinds';
import { firstTurns } from '../model/turns';
import type { ObjectStore } from './store';

// Fixed, so every device, and every read of an old backup, upgrades one connection to the same value: a restore
// carried on after a stop compares what it wrote with the backup's copy.
const ACCOUNT = 'account-1';
const GROUP = 'group-1';

// The kinds upgradeValue upgrades, and so the only ones the store holds as upgraded.
type Upgraded = 'connection' | 'character' | 'module' | 'memory';

// Every decrypted value and every backup line passes here before anything reads it. null for a value already current.
// No step is retired: an E2E value is upgraded only when a client reads it, so the server can still hold any old shape.
export function upgradeValue(kind: string, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (kind === 'connection') return upgradeConnection(value);
  if (kind === 'character') return upgradeCharacter(value);
  if (kind === 'module') return scriptIds(value);
  if (kind === 'memory') return upgradeMemory(value);
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

// Each in turn, so a character stored before several upgrades takes them all. statusIds reads the ids cardScriptIds
// gives.
function upgradeCharacter(value: Record<string, unknown>) {
  let upgraded: Record<string, unknown> | null = null;
  for (const step of [dropTranslate, translationsByText, cardScriptIds, statusIds, dropKeepStatus]) upgraded = step(upgraded ?? value) ?? upgraded;
  return upgraded;
}

// Until 2026-10-06 every character kept its own translation switches in translate; the shared ones replaced them
// (design §6.3).
function dropTranslate(value: Record<string, unknown>) {
  return 'translate' in value ? without(value, 'translate') : null;
}

// Until 2026-10-07 only greetings were translated on the character, in greetingTranslations by greeting.
function translationsByText(value: Record<string, unknown>) {
  if (!Array.isArray(value.greetingTranslations)) return null;
  const { greetingTranslations, ...rest } = value;
  return { ...rest, translations: greetingTranslations.map(({ greeting, ...each }: { greeting: string }) => ({ source: greeting, ...each })) };
}

// Until 2026-10-08 a pack's scripts had no ids.
function scriptIds(pack: Record<string, unknown>) {
  const { regex, triggers } = pack;
  if (!Array.isArray(regex) || !Array.isArray(triggers)) return null;
  const stamped = stampIds({ regex, triggers });
  const same = stamped.regex.every((script, place) => script === regex[place]) && stamped.triggers.every((trigger, place) => trigger === triggers[place]);
  return same ? null : { ...pack, ...stamped };
}

function cardScriptIds(value: Record<string, unknown>) {
  const card = isRecord(value.card) ? scriptIds(value.card) : null;
  return card && { ...value, card };
}

// Until 2026-10-08 상태창 지정 named display scripts by their place in card.regex. A tab still on that build may add a
// place to ids already upgraded, so each is read alone, through the card as it stands now.
function statusIds(value: Record<string, unknown>) {
  const marks = value.statusScripts;
  if (!Array.isArray(marks) || !marks.some((mark) => typeof mark === 'number')) return null;
  const regex: unknown[] = isRecord(value.card) && Array.isArray(value.card.regex) ? value.card.regex : [];
  const ids = marks.flatMap((mark: unknown) => {
    if (typeof mark !== 'number') return [mark];
    const script = regex[mark];
    return isRecord(script) && typeof script.id === 'string' ? [script.id] : [];
  });
  return { ...value, statusScripts: [...new Set(ids)] };
}

// Until 2026-10-09 옆에 두기 could keep 상태 in the story's margin.
function dropKeepStatus(value: Record<string, unknown>) {
  return 'keepStatus' in value ? without(value, 'keepStatus') : null;
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
