import { fitsRole } from '../connectors/assignment';
import { RETRIES } from '../connectors/registry';
import type { Account, Connection, ConnectionType, Model, Starred, Turns } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import { firstTurns, groupOf, putBack, removeAccount as withoutAccount, signedIn } from '../model/turns';
import type { ApiFailure, ApiResult } from './api';
import { setDefaultModel } from './assignment';
import type { CatalogFailure } from './catalog';
import type { MetersFailure } from './meters';
import type { Session } from './session';
import type { ObjectStore } from './store';

export const newAccount = (secret: string, name?: string): Account => ({ id: crypto.randomUUID(), secret, ...(name !== undefined && { name }) });

// name: who signed in. A pool starts with the account alone in its first group.
export function providerConnection(type: ConnectionType, secret: string, name?: string): Connection {
  const account = newAccount(secret, name);
  return { type: type.id, label: type.label, baseUrl: null, protocol: null, accounts: [account], turns: type.pool ? firstTurns(crypto.randomUUID(), account.id) : null, starred: [] };
}

// models: the model list did not load. key: the provider refused the key every meters request asked with.
// stopped: the caller gave up (signal) before the save.
export type AddFailure =
  | { kind: 'models'; failure: CatalogFailure }
  | { kind: 'key'; failure: MetersFailure }
  | { kind: 'save'; failure: ApiFailure }
  | { kind: 'stopped' };

// The model list must load before the connection is saved. A model list
// may be public (OpenRouter's is), so a key every meters request refuses (401) stops the save too. Never one refusal
// alone: what NanoGPT's subscription usage answers a working key without a subscription is undocumented. Any other
// trouble with the meters leaves them to their own block on the next screen.
// Leaving the screen (signal) while these load saves nothing.
export async function addConnection({ store, catalogs, credentials }: Session, connection: Connection, signal?: AbortSignal): Promise<{ ok: true; id: string } | { ok: false; failure: AddFailure }> {
  // Asked first, so a pool's pick for the model list reads these same meters.
  const metered = credentials.pool.meters(connection, connection.accounts[0]!, { fresh: true });
  const [catalog, meters] = await Promise.all([catalogs.load(connection, { fresh: true }), metered]);
  if (signal?.aborted) return { ok: false, failure: { kind: 'stopped' } };
  if (!catalog.ok) return { ok: false, failure: { kind: 'models', failure: catalog.failure } };
  const refused = meters && !meters.meters.length && meters.failures.length > 0 && meters.failures.every((failure) => failure.kind === 'provider' && failure.status === 401) ? meters.failures[0] : undefined;
  if (refused) return { ok: false, failure: { kind: 'key', failure: refused } };
  const saved = await store.create('connection', connection);
  return saved.ok ? { ok: true, id: saved.data.id } : { ok: false, failure: { kind: 'save', failure: saved } };
}

// The others are kept apart first, so a star the model got meanwhile on another device is not doubled.
// The first model starred that can talk becomes the 대화 모델: until one is set no chat can send, and with one there is nothing to
// choose between.
export async function setStarred(store: ObjectStore, id: string, model: Model, starred: boolean): Promise<ApiResult<Stored<'connection'>>> {
  const saved = await store.update('connection', id, (current) => {
    const others = current.starred.filter((entry) => entry.id !== model.id);
    return { ...current, starred: starred ? [...others, model] : others };
  });
  if (saved.ok && starred && fitsRole(model, 'main') && !store.get('settings', SETTINGS_ID)?.value.models.main) await setDefaultModel(store, 'main', { connection: id, model: model.id });
  return saved;
}

// Key order aside, so a snapshot written in another order is not taken for a change.
const sameValue = (a: unknown, b: unknown) => {
  const sorted = (value: unknown) => JSON.stringify(value, (_, field: unknown) => (isRecord(field) ? Object.fromEntries(Object.entries(field).sort(([x], [y]) => (x < y ? -1 : 1))) : field));
  return sorted(a) === sorted(b);
};

// A loaded model list makes each starred snapshot what the list says of the model now, keeping the user's own fields
// (profile). A model the list no longer has keeps its snapshot, and one it leaves unpriced, or whose inputs or outputs it
// leaves unknown, keeps what it had: a models.dev list that did not load reads the same.
export async function refreshStarred(store: ObjectStore, id: string, models: Model[]): Promise<void> {
  const loaded = new Map(models.map((model) => [model.id, model]));
  const fresh = (model: Starred): Starred => {
    const listed = loaded.get(model.id);
    if (!listed) return model;
    return {
      ...listed,
      input: listed.input ?? model.input,
      output: listed.output ?? model.output,
      ...(listed.price === undefined && model.price !== undefined && { price: model.price }),
      ...(model.profile !== undefined && { profile: model.profile }),
    };
  };
  if (store.get('connection', id)?.value.starred.every((model) => sameValue(fresh(model), model)) !== false) return;
  await store.update('connection', id, (current) => ({ ...current, starred: current.starred.map(fresh) }));
}

// The default count is kept as none, so it follows the default.
export const setRetries = (store: ObjectStore, id: string, retries: number) =>
  store.update('connection', id, (current) => {
    const next: Connection = { ...current, retries };
    if (retries === RETRIES) delete next.retries;
    return next;
  });

export const removeConnection = (store: ObjectStore, id: string) => store.take('connection', id);

export const restoreConnection = (store: ObjectStore, removed: Stored<'connection'>) => store.restore(removed);

type Pooled = Connection & { turns: Turns };
const pooled = (connection: Connection): connection is Pooled => connection.turns !== null;

// A pool's groups and their turns (model/turns); a change that answers null writes nothing.
export const changeTurns = (store: ObjectStore, id: string, change: (turns: Turns) => Turns | null) =>
  store.update('connection', id, (current) => {
    const turns = current.turns && change(current.turns);
    return turns ? { ...current, turns } : null;
  });

export const addAccount = (store: ObjectStore, id: string, account: Account) =>
  store.update('connection', id, (current) => (pooled(current) ? signedIn(current, account, Date.now()) : null));

// What removeAccount took, for putAccountBack.
export type Taken = { account: Account; group: string; index: number };

export async function removeAccount(store: ObjectStore, id: string, account: string): Promise<ApiResult<Taken>> {
  let taken: Taken | null = null;
  const saved = await store.update('connection', id, (current) => {
    const group = current.turns && groupOf(current.turns, account);
    const held = current.accounts.find((entry) => entry.id === account);
    if (!pooled(current) || !group || !held) return null;
    taken = { account: held, group: group.id, index: group.accounts.indexOf(account) };
    return withoutAccount(current, account);
  });
  return saved.ok ? { ok: true, data: taken! } : saved;
}

export const putAccountBack = (store: ObjectStore, id: string, { account, group, index }: Taken) =>
  store.update('connection', id, (current) => (pooled(current) ? putBack(current, account, group, index, Date.now()) : null));
