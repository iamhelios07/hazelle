import type { VaultKey } from '../vault/keys';
import { api, type ApiResult } from './api';
import { AssetUrls } from './assets';
import { Catalogs } from './catalog';
import { purgeExpired } from './characters';
import { Costs } from './cost';
import { Credentials } from './credential';
import { Files } from './files';
import { Rememberer } from './memory';
import { addFirstPersona } from './personas';
import { addFirstProfile } from './profiles';
import { addDefaults } from './prompts';
import { keepSynced, ObjectStore, type PullProgress } from './store';
import { Talk } from './talk';
import { Translator } from './translate';
import { ReadModels } from './read-model';
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
  credentials: Credentials;
  catalogs: Catalogs;
  read: ReadModels;
  // Stops sync, the reply and the background work, and drops the tokens and model lists. Every way out
  // of an open vault (잠그기, 로그아웃) unmounts app/shell/Workspace, which calls it.
  close: () => void;
  startBackground: () => void;
};

// Pulls once before the first screen, then keeps the store in sync while the session is open. An open
// given up while it pulls (signal) starts nothing.
export async function openSession(accountId: string, vaultKey: VaultKey, username: string, signal: AbortSignal, progress?: (progress: PullProgress) => void): Promise<ApiResult<Session>> {
  const store = await ObjectStore.open(accountId, vaultKey, api);
  const pulled = await store.pull({ signal, progress });
  if (pulled) return pulled;
  const files = new Files(api);
  const assets = new AssetUrls(store, files);
  // Awaited rather than started, so the first screen and every turn already see the default prompts, persona and 묶음.
  await Promise.all([addDefaults(store), addFirstPersona(store, username), addFirstProfile(store)]);
  if (signal.aborted) return { ok: false, error: 'stopped' };

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const costs = new Costs(store);
  const reading = new Set<string>();
  const translator = new Translator(store, credentials, costs, reading);
  const read = new ReadModels(store);
  const memory = new Rememberer({ store, read, credentials }, reading);
  const talk = new Talk(
    store,
    credentials,
    costs,
    (chat) => {
      translateLatest({ store, read, talk, translator }, chat);
      memory.check(chat);
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
    streams.pickUp();
    void purgeExpired(store, Date.now(), closing.signal);
    void backfillSummaries(store, closing.signal);
  };

  const close = () => {
    closing.abort();
    stopSync();
    read.close();
    streams.close();
    talk.close();
    translator.close();
    memory.close();
    costs.close();
    catalogs.close();
    credentials.close();
    assets.close();
    store.close();
  };
  return { ok: true, data: { username, store, files, assets, talk, costs, translator, memory, streams, credentials, catalogs, read, close, startBackground } };
}
