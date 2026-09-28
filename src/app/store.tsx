import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Connection } from '../connectors/types';
import { chatTitle, fold, preview, type Chat, type Entry, type Message } from '../runtime/chat';
import { SETTINGS_ID, type Settings } from '../runtime/docs';
import { nest, shelve, type Avatar, type Character, type Folder } from '../runtime/library';
import type { ObjectStore, Stored } from '../runtime/store';
import type { Talk, Turn } from '../runtime/talk';

const StoreContext = createContext<ObjectStore | null>(null);
const TalkContext = createContext<Talk | null>(null);

export const StoreProvider = StoreContext.Provider;
export const TalkProvider = TalkContext.Provider;

export function useStore(): ObjectStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

// The store's version is the snapshot, and lists are rebuilt only when it changes: a selector that
// returned a fresh array every time would make React re-render forever.
function useVersion(store: ObjectStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

export function useConnections(): Stored<Connection>[] {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.list<Connection>('connection'), [store, version]);
}

export function useConnection(id: string): Stored<Connection> | null {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get<Connection>(id), [store, version, id]);
}

// Until something is saved, nothing is assigned: an empty layer, not a guessed default.
export function useSettings(): Settings {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get<Settings>(SETTINGS_ID)?.value ?? { models: {} }, [store, version]);
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
  return useMemo(() => {
    const entries = new Map<string, Stored<Entry>[]>();
    for (const entry of store.list<Entry>('entry')) {
      const own = entries.get(entry.parent!);
      if (own) own.push(entry);
      else entries.set(entry.parent!, [entry]);
    }
    return store
      .list<Chat>('chat')
      .map((chat) => {
        const own = entries.get(chat.id) ?? [];
        const messages = fold(own);
        const latest = own.reduce<Stored<Entry> | null>((last, entry) => (last && last.rev > entry.rev ? last : entry), null);
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
      .sort((a, b) => b.order - a.order);
  }, [store, version]);
}

// The characters, each with its chats, most recent first, and the folders by name (design F6).
export function useLibrary() {
  const store = useStore();
  const version = useVersion(store);
  const chats = useChats();
  return useMemo(
    () => ({
      ...shelve(store.list<Character>('character'), store.list<Avatar>('avatar'), chats),
      folders: nest(store.list<Folder>('folder')),
    }),
    [store, version, chats],
  );
}

// How many lorebook entries a character holds, which its chats do not use yet (runtime/prompt).
export function useLoreCount(character: string | null): number {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => (character === null ? 0 : store.list<unknown>('lore').filter((entry) => entry.parent === character).length), [store, version, character]);
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
