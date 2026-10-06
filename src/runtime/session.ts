import type { VaultKey } from '../vault/keys';
import { api, type ApiResult } from './api';
import { AssetUrls } from './assets';
import { Catalogs } from './catalog';
import { dropCharacterTranslate, purgeExpired } from './characters';
import { Costs } from './cost';
import { Credentials } from './credential';
import { Files } from './files';
import { deviceCache } from './device-cache';
import { Drafts } from './drafts';
import type { DeviceCache } from './object-cache';
import { Rememberer } from './memory';
import { addFirstPersona, recordChatPersonas } from './personas';
import { addFirstProfile } from './profiles';
import { addDefaults } from './prompts';
import { keepSynced, ObjectStore, type PullProgress } from './store';
import { Talk } from './talk';
import { Translator } from './translate';
import { Usage } from './usage';
import { LuaStuck, LuaWorker, type Runner } from './lua/client';
import { ReadModels } from './read-model';
import { ScriptDisplay } from './script-display';
import { Scripts } from './scripts';
import { Streams } from './streams';
import { backfillSummaries } from './summary';
import { receiveReply, resumeSend } from './turn';
import { saveUpgraded } from './upgrade';

export type Session = {
  username: string;
  store: ObjectStore;
  files: Files;
  assets: AssetUrls;
  talk: Talk;
  costs: Costs;
  usage: Usage;
  translator: Translator;
  memory: Rememberer;
  drafts: Drafts;
  streams: Streams;
  scripts: Scripts;
  credentials: Credentials;
  catalogs: Catalogs;
  read: ReadModels;
  // Every way out of an open vault (잠그기, 로그아웃) unmounts app/shell/Workspace, which calls it.
  close: () => void;
  startBackground: () => void;
};

// Its worker starts, and the VM loads, when a chat's bot first runs Lua, never with the page.
const luaWorker = (): Promise<Runner> => Promise.resolve(new LuaWorker());

// An open given up while it loads (signal) starts nothing. A cached opening never waits for the network.
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
  const files = new Files(api, store);
  const assets = new AssetUrls(store, files);
  // A new account sees its defaults on the first screen; a cached account fills missing defaults after catch-up.
  const defaults = () => Promise.all([addDefaults(store), addFirstPersona(store, username).then(() => recordChatPersonas(store)), addFirstProfile(store), dropCharacterTranslate(store), saveUpgraded(store)]);
  if (!store.cached) await defaults();
  if (signal.aborted) {
    store.close();
    return { ok: false, error: 'stopped' };
  }

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const costs = new Costs(store);
  const usage = new Usage(store);
  const drafts = new Drafts();
  const reading = new Set<string>();
  const translator = new Translator(store, credentials, costs, reading);
  let runner: Promise<Runner> | null = null;
  // Asked for once the session has closed, it makes none: nothing would be left to end it.
  const machine = () => (closing.signal.aborted ? Promise.reject<Runner>(new LuaStuck('closed')) : (runner ??= lua()));
  const display: ScriptDisplay = new ScriptDisplay(store, machine, (chat, result) => scripts.report(chat, result));
  const read = new ReadModels(store, display);
  const memory = new Rememberer({ store, read, credentials }, reading);
  const scripts: Scripts = new Scripts({ store, read, credentials, costs, display }, machine);
  const talk = new Talk(
    store,
    credentials,
    costs,
    (chat, reply) => scripts.ending(chat, reply),
    // The bot's onOutput may rewrite the reply, so what reads the reply waits for it. The lease, taken while Talk still
    // holds the chat, keeps it loaded for the continuation or translation however soon the chat is left.
    (chat, reply) => {
      const lease = store.retainChat(chat);
      void scripts.ended(chat, reply).finally(() => {
        void receiveReply(session, chat, reply).finally(lease.release);
        memory.check(chat);
      });
    },
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
    display.close();
    streams.close();
    talk.close();
    scripts.close();
    // One still being made is ended as it is made.
    void runner?.then((made) => made.close());
    translator.close();
    memory.close();
    drafts.close();
    costs.close();
    usage.close();
    catalogs.close();
    credentials.close();
    assets.close();
    store.close();
  };
  const session: Session = { username, store, files, assets, talk, costs, usage, translator, memory, drafts, streams, scripts, credentials, catalogs, read, close, startBackground };
  return { ok: true, data: session };
}
