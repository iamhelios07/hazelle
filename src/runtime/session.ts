import type { VaultKey } from '../vault/keys';
import { api, type ApiResult } from './api';
import { AssetUrls } from './assets';
import { Catalogs } from './catalog';
import { purgeExpired } from './characters';
import { Costs } from './cost';
import { Credentials } from './credential';
import { Files } from './files';
import { addFirstPersona } from './personas';
import { addFirstProfile } from './profiles';
import { addDefaults } from './prompts';
import { keepSynced, ObjectStore } from './store';
import { Talk } from './talk';
import { Translator } from './translate';
import { ReadModels } from './read-model';
import { translateLatest } from './turn';

export type Session = {
  username: string;
  store: ObjectStore;
  files: Files;
  assets: AssetUrls;
  talk: Talk;
  costs: Costs;
  translator: Translator;
  credentials: Credentials;
  catalogs: Catalogs;
  read: ReadModels;
  // Stops sync, the reply and the background work, and drops the tokens and model lists. Every way out
  // of an open vault (잠그기, 로그아웃) unmounts app/shell/Workspace, which calls it.
  close: () => void;
};

// Pulls once before the first screen, then keeps the store in sync while the session is open. An open
// given up while it pulls (signal) starts nothing.
export async function openSession(accountId: string, vaultKey: VaultKey, username: string, signal: AbortSignal): Promise<ApiResult<Session>> {
  const store = await ObjectStore.open(accountId, vaultKey, api);
  const pulled = await store.pull();
  if (pulled) return pulled;
  const files = new Files(api);
  const assets = new AssetUrls(store, files);
  // Awaited rather than started, so the first screen and every turn already see the default prompts, persona and 묶음.
  await Promise.all([addDefaults(store), addFirstPersona(store, username), addFirstProfile(store)]);
  if (signal.aborted) return { ok: false, error: 'stopped' };

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const costs = new Costs(store);
  const translator = new Translator(store, credentials, costs);
  const read = new ReadModels(store);
  const talk = new Talk(store, credentials, costs, (chat) => translateLatest({ store, read, talk, translator }, chat));
  const stopSync = keepSynced(store);
  const closing = new AbortController();
  void purgeExpired(store, Date.now(), closing.signal);

  const close = () => {
    closing.abort();
    stopSync();
    read.close();
    talk.close();
    translator.close();
    costs.close();
    catalogs.close();
    credentials.close();
    assets.close();
  };
  return { ok: true, data: { username, store, files, assets, talk, costs, translator, credentials, catalogs, read, close } };
}
