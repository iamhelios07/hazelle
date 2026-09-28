import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatItem } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { CharacterShelf } from '../model/library';
import type { Settings } from '../model/settings';
import type { Files } from '../runtime/files';
import type { Session, Views } from '../runtime/session';
import type { ObjectStore } from '../runtime/store';
import type { Talk, Turn } from '../runtime/talk';

export type Account = { onLock: () => void; onLogout: () => Promise<string | null> };

const SessionContext = createContext<{ session: Session; account: Account } | null>(null);

export function SessionProvider({ session, account, children }: { session: Session; account: Account; children: ReactNode }) {
  return <SessionContext value={{ session, account }}>{children}</SessionContext>;
}

function useOpen() {
  const open = useContext(SessionContext);
  if (!open) throw new Error('session hook outside SessionProvider');
  return open;
}

export const useSession = (): Session => useOpen().session;
export const useAccount = (): Account => useOpen().account;
export const useStore = (): ObjectStore => useSession().store;
export const useFiles = (): Files => useSession().files;
export const useTalk = (): Talk => useSession().talk;

// Every snapshot below is either one the session built for this store version or an object the store
// holds as it is: a selector that built a fresh array or object each time would make React re-render forever.
function useViews(): Views {
  const session = useSession();
  return useSyncExternalStore(session.store.subscribe, session.views);
}

export const useChats = (): ChatItem[] => useViews().chats;
export const useLibrary = (): Views['library'] => useViews().library;
export const useConnections = (): Stored<'connection'>[] => useViews().connections;
export const useSettings = (): Settings => useViews().settings;
export const useUnreadable = (): number => useViews().unreadable;

export function useChat(id: string | null): ChatItem | null {
  const { chatById } = useViews();
  return id === null ? null : (chatById.get(id) ?? null);
}

export function useCharacter(id: string | null): CharacterShelf<ChatItem> | null {
  const { characterById } = useViews();
  return id === null ? null : (characterById.get(id) ?? null);
}

export function useConnection(id: string): Stored<'connection'> | null {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => store.get('connection', id));
}

// How many lorebook entries a character holds, which its chats do not use yet (engine/pipeline).
export function useLoreCount(character: string | null): number {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => (character === null ? 0 : store.children('lore', character).length));
}

export function useTurn(): Turn | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, talk.snapshot);
}
