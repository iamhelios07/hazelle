import type { VaultKey } from '../vault/keys';
import { api, type ApiResult } from './api';
import { AssetUrls } from './assets';
import { Catalogs } from './catalog';
import { purgeExpired } from './characters';
import { Costs } from './cost';
import { Credentials } from './credential';
import { Files } from './files';
import { deviceCache } from './device-cache';
import type { DeviceCache } from './object-cache';
import { Rememberer } from './memory';
import { addFirstPersona } from './personas';
import { addFirstProfile } from './profiles';
import { addDefaults } from './prompts';
import { keepSynced, ObjectStore, type PullProgress } from './store';
import { Talk } from './talk';
import { Translator } from './translate';
import { LuaWorker, type Runner } from './lua/client';
import { ReadModels } from './read-model';
import { ScriptDisplay } from './script-display';
import { Scripts } from './scripts';
import { Streams } from './streams';
import { backfillSummaries } from './summary';
import { resumeSend, translateLatest } from './turn';

export type Session = {
  username: string;
  store: ObjectStore;
  files: Files;
  assets: AssetUrls;
  talk: Talk;
  costs: Costs;
  translator: Translator;
  memory: Rememberer;
  streams: Streams;
  scripts: Scripts;
  credentials: Credentials;
  catalogs: Catalogs;
  read: ReadModels;
  // Stops sync, the reply and the background work, and drops the tokens and model lists. Every way out
  // of an open vault (잠그기, 로그아웃) unmounts app/shell/Workspace, which calls it.
  close: () => void;
  startBackground: () => void;
};

// Its worker starts, and the VM loads, when a chat's bot first runs Lua, never with the page.
const luaWorker = (): Promise<Runner> => Promise.resolve(new LuaWorker());

// An open given up while it loads (signal) starts nothing. A cached opening never waits for the network.
// lua: where the bot scripts run.
export async function openSession(accountId: string, vaultKey: VaultKey, username: string, signal: AbortSignal, progress?: (progress: PullProgress) => void, cache: DeviceCache = deviceCache(accountId), lua: () => Promise<Runner> = luaWorker): Promise<ApiResult<Session>> {
  const store = await ObjectStore.open(accountId, vaultKey, api, cache, signal);
  if (signal.aborted) {
    store.close();
    return { ok: false, error: 'stopped' };
  }
  if (!store.cached) {
    const pulled = await store.pull({ signal, progress });
    if (pulled) {
      store.close();
      return pulled;
    }
  }
  const files = new Files(api);
  const assets = new AssetUrls(store, files);
  // A new account sees its defaults on the first screen; a cached account fills missing defaults after catch-up.
  const defaults = () => Promise.all([addDefaults(store), addFirstPersona(store, username), addFirstProfile(store)]);
  if (!store.cached) await defaults();
  if (signal.aborted) {
    store.close();
    return { ok: false, error: 'stopped' };
  }

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const costs = new Costs(store);
  const reading = new Set<string>();
  const translator = new Translator(store, credentials, costs, reading);
  let runner: Promise<Runner> | null = null;
  const machine = () => (runner ??= lua());
  const display: ScriptDisplay = new ScriptDisplay(store, machine, (chat, result) => scripts.report(chat, result));
  const read = new ReadModels(store, display);
  const memory = new Rememberer({ store, read, credentials }, reading);
  const scripts: Scripts = new Scripts({ store, read, credentials, costs, display }, machine);
  const talk = new Talk(
    store,
    credentials,
    costs,
    (chat, reply) => scripts.ending(chat, reply),
    // The bot's onOutput may rewrite the reply, so what reads the reply waits for it.
    (chat, reply) =>
      void scripts.ended(chat, reply).finally(() => {
        translateLatest({ store, read, talk, translator }, chat);
        memory.check(chat);
      }),
    reading,
  );
  const closing = new AbortController();
  const streams: Streams = new Streams(store, reading, (stream) => {
    const purpose = stream.value.for;
    if (purpose.kind === 'reply') void talk.resume(stream);
    else if (purpose.kind === 'translation') translator.resume(stream, purpose.version);
    else if (purpose.kind === 'memory') memory.resume(stream);
    else void resumeSend({ store, streams }, stream, closing.signal);
  });
  let started = false;
  const stopSync = keepSynced(store, () => { if (started && !closing.signal.aborted) streams.pickUp(); });
  const startBackground = () => {
    if (started || closing.signal.aborted) return;
    started = true;
    void (async () => {
      if (store.cached) {
        const failure = await store.pull();
        if (failure || closing.signal.aborted) return;
        await defaults();
      }
      if (closing.signal.aborted) return;
      streams.pickUp();
      void purgeExpired(store, Date.now(), closing.signal);
      void backfillSummaries(store, closing.signal);
    })();
  };

  const close = () => {
    closing.abort();
    stopSync();
    read.close();
    streams.close();
    talk.close();
    scripts.close();
    translator.close();
    memory.close();
    costs.close();
    catalogs.close();
    credentials.close();
    assets.close();
    store.close();
  };
  return { ok: true, data: { username, store, files, assets, talk, costs, translator, memory, streams, scripts, credentials, catalogs, read, close, startBackground } };
}
