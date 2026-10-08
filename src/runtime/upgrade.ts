import { CONNECTION_TYPES } from '../connectors/registry';
import { isRecord } from '../connectors/values';
import { stampIds } from '../engine/import/convert';
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
  if (kind === 'module') return scriptIds(value);
  return null;
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
  for (const step of [translationsByText, cardScriptIds, statusIds]) upgraded = step(upgraded ?? value) ?? upgraded;
  return upgraded;
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

// An upgrade can reach every character and module, and each write is a request of its own, so they go a group at a
// time. In process, 16 at a time took as long as all at once (469 characters, about 2 s); in a browser it is unmeasured.
const WRITE_GROUP = 16;

// The stored copies of what the store upgraded as it read them, written back once, so the old shape leaves the
// account. Each is written as it is held then, so a change another device made meanwhile is kept.
export async function saveUpgraded(store: ObjectStore): Promise<void> {
  const upgraded = store.takeUpgraded();
  for (let at = 0; at < upgraded.length; at += WRITE_GROUP) await Promise.all(upgraded.slice(at, at + WRITE_GROUP).map(({ id, kind }) => resave(store, kind, id)));
}

// upgradeValue upgrades these three kinds only.
const resave = (store: ObjectStore, kind: string, id: string) =>
  kind === 'character' ? store.update('character', id, (current) => current) : kind === 'module' ? store.update('module', id, (current) => current) : store.update('connection', id, (current) => current);
