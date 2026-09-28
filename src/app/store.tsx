import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { chatTitle, fold, preview, type Chat, type Message } from '../model/chat';
import type { Stored } from '../model/kinds';
import { nest, shelve } from '../model/library';
import { SETTINGS_ID, type Settings } from '../model/settings';
import type { OpenVault } from '../runtime/blobs';
import type { ObjectStore } from '../runtime/store';
import type { Talk, Turn } from '../runtime/talk';

const StoreContext = createContext<ObjectStore | null>(null);
const TalkContext = createContext<Talk | null>(null);
const VaultContext = createContext<OpenVault | null>(null);

export const StoreProvider = StoreContext.Provider;
export const TalkProvider = TalkContext.Provider;
export const VaultProvider = VaultContext.Provider;

export function useStore(): ObjectStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

// What reads and writes sealed files, such as a character's picture.
export function useVault(): OpenVault {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault outside VaultProvider');
  return vault;
}

// The store's version is the snapshot, and lists are rebuilt only when it changes: a selector that
// returned a fresh array every time would make React re-render forever.
function useVersion(store: ObjectStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

export function useConnections(): Stored<'connection'>[] {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.list('connection'), [store, version]);
}

export function useConnection(id: string): Stored<'connection'> | null {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get('connection', id), [store, version, id]);
}

// Until something is saved, nothing is assigned: an empty layer, not a guessed default.
export function useSettings(): Settings {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get('settings', SETTINGS_ID)?.value ?? { models: {} }, [store, version]);
}

export function useUnreadable(): number {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.unreadable(), [store, version]);
}

export type ChatItem = { id: string; chat: Chat; messages: Message[]; title: string; preview: string; at: number | null; order: number };

// Every chat with its messages, the one written to last first. Renaming a chat or changing its model
// does not move it.
export function useChats(): ChatItem[] {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(
    () =>
      store
        .list('chat')
        .map((chat) => {
          const own = store.children('entry', chat.id);
          const messages = fold(own);
          const latest = own.reduce<Stored<'entry'> | null>((last, entry) => (last && last.rev > entry.rev ? last : entry), null);
          return {
            id: chat.id,
            chat: chat.value,
            messages,
            title: chatTitle(chat.value, messages),
            preview: preview(messages),
            at: latest?.value.at ?? null,
            order: latest?.rev ?? chat.rev,
          };
        })
        .sort((a, b) => b.order - a.order),
    [store, version],
  );
}

// The characters, each with its chats, most recent first, and the folders by name (design F6).
export function useLibrary() {
  const store = useStore();
  const version = useVersion(store);
  const chats = useChats();
  return useMemo(
    () => ({
      ...shelve(store.list('character'), store.list('avatar'), chats),
      folders: nest(store.list('folder')),
    }),
    [store, version, chats],
  );
}

// How many lorebook entries a character holds, which its chats do not use yet (runtime/prompt).
export function useLoreCount(character: string | null): number {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => (character === null ? 0 : store.children('lore', character).length), [store, version, character]);
}

export function useTalk(): Talk {
  const talk = useContext(TalkContext);
  if (!talk) throw new Error('useTalk outside TalkProvider');
  return talk;
}

export function useTurn(): Turn | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, talk.snapshot);
}
