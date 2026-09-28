import { chatItems, type ChatItem } from '../model/chat';
import type { Kind, Stored } from '../model/kinds';
import { nest, shelve, type CharacterShelf, type FolderTree, type Shelf } from '../model/library';
import { SETTINGS_ID, type Settings } from '../model/settings';
import type { VaultKey } from '../vault/keys';
import { api, type ApiResult } from './api';
import { Catalogs } from './catalog';
import { purgeExpired } from './characters';
import { Credentials } from './credential';
import { Files } from './files';
import { addStarter } from './prompts';
import { keepSynced, ObjectStore } from './store';
import { Talk } from './talk';
import { displayChat } from './turn';

export type Views = {
  chats: ChatItem[];
  chatById: ReadonlyMap<string, ChatItem>;
  // The characters, each with its chats, most recent first, and the folders by name (design F6).
  library: { characters: CharacterShelf<ChatItem>[]; none: Shelf<ChatItem>; deleted: CharacterShelf<ChatItem>[]; folders: FolderTree[] };
  // The characters not in 지운 캐릭터.
  characterById: ReadonlyMap<string, CharacterShelf<ChatItem>>;
  connections: Stored<'connection'>[];
  prompts: Stored<'prompt'>[];
  personas: Stored<'persona'>[];
  settings: Settings;
  unreadable: number;
};

export type Session = {
  username: string;
  store: ObjectStore;
  files: Files;
  talk: Talk;
  credentials: Credentials;
  catalogs: Catalogs;
  // The same object until the store's version changes, so useSyncExternalStore can read it directly.
  views: () => Views;
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
  const files = await Files.open(accountId, vaultKey, api);
  // Awaited rather than started, so the first screen and every turn already see the default prompt.
  await addStarter(store);
  if (signal.aborted) return { ok: false, error: 'stopped' };

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const talk = new Talk(store, credentials);
  const stopSync = keepSynced(store);
  const closing = new AbortController();
  void purgeExpired(store, files, Date.now(), closing.signal);

  let cached: { version: number; views: Views } | null = null;
  const displayed = new Map<string, Displayed>();
  const views = () => {
    const version = store.snapshot();
    if (cached?.version !== version) cached = { version, views: derive(store, username, displayed) };
    return cached.views;
  };
  const close = () => {
    closing.abort();
    stopSync();
    talk.close();
    catalogs.close();
    credentials.close();
  };
  return { ok: true, data: { username, store, files, talk, credentials, catalogs, views, close } };
}

// A chat's shown texts as last rendered, and the key of what they were rendered from.
type Displayed = { key: string; texts: string[] };

// What any chat's display reads besides the chat itself and its entries.
const SHARED: readonly Kind[] = ['character', 'lore', 'prompt', 'persona', 'settings', 'connection'];
// Every write takes the account's next rev (tech-spec §5), so the count and highest rev of a set of objects
// change with any write to it, a deletion included.
const written = (objects: Stored<Kind>[]) => `${objects.length}:${objects.reduce((max, { rev }) => Math.max(max, rev), 0)}`;

// A chat is rendered again only when it, its entries or what every chat reads changed, so a new message
// renders its own chat alone.
function derive(store: ObjectStore, username: string, displayed: Map<string, Displayed>): Views {
  const shared = SHARED.map((kind) => written(store.list(kind))).join('|');
  const chats = chatItems(
    store.list('chat'),
    (chat) => store.children('entry', chat),
    (chat, messages) => {
      const key = `${shared}|${chat.rev}|${written(store.children('entry', chat.id))}`;
      const held = displayed.get(chat.id);
      if (held?.key === key) return held.texts;
      const texts = displayChat({ store, username }, chat.id, chat.value, messages);
      displayed.set(chat.id, { key, texts });
      return texts;
    },
  );
  for (const id of displayed.keys()) if (!store.get('chat', id)) displayed.delete(id);
  const shelves = shelve(store.list('character'), store.list('avatar'), chats);
  return {
    chats,
    chatById: new Map(chats.map((item) => [item.id, item])),
    library: { ...shelves, folders: nest(store.list('folder')) },
    characterById: new Map(shelves.characters.map((shelf) => [shelf.id, shelf])),
    connections: store.list('connection'),
    prompts: store.list('prompt'),
    personas: store.list('persona'),
    // Until something is saved, nothing is assigned: an empty layer, not a guessed default.
    settings: store.get('settings', SETTINGS_ID)?.value ?? { models: {} },
    unreadable: store.unreadable(),
  };
}
