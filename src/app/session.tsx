import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatScope } from '../engine/render';
import type { Kind } from '../model/kinds';
import { memoryId, type Memory } from '../model/memory';
import type { Files } from '../runtime/files';
import type { Remembering } from '../runtime/memory';
import type { Session } from '../runtime/session';
import type { Opening } from '../runtime/read-model';
import type { ObjectStore } from '../runtime/store';
import type { Talk, Turn } from '../runtime/talk';
import type { Translating, Translator } from '../runtime/translate';

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
export const useTranslator = (): Translator => useSession().translator;

// A bot asset's picture URL as the session has it (runtime/assets). The function is a new one when a picture has
// loaded, so what shows pictures renders again.
export function useAssetUrl(): (id: string) => string | undefined {
  const { assets } = useSession();
  const version = useSyncExternalStore(assets.subscribe, assets.snapshot);
  return useCallback((id: string) => assets.url(id), [assets, version]);
}

// Every snapshot below is held until its own inputs change: fresh selector arrays would make React re-render forever.
export function useChats() {
  const { read } = useSession();
  return useSyncExternalStore(read.chats.subscribe, read.chats.snapshot);
}

export function useChatModel(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.chat(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useChatSummary(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.summary(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useChatMessages() {
  const { read } = useSession();
  return useSyncExternalStore(read.messages.subscribe, read.messages.snapshot);
}

export function useLibrary() {
  const { read } = useSession();
  return useSyncExternalStore(read.library.subscribe, read.library.snapshot);
}

function useKind<K extends Kind>(kind: K) {
  const model = useSession().read.kind(kind);
  return useSyncExternalStore(model.subscribe, model.snapshot);
}

export const useConnections = () => useKind('connection');
export const usePrompts = () => useKind('prompt');
export const usePersonas = () => useKind('persona');
export const useProfiles = () => useKind('profile');
export function useSettings() {
  const { read } = useSession();
  return useSyncExternalStore(read.settings.subscribe, read.settings.snapshot);
}
export function useUnreadable() {
  const { read } = useSession();
  return useSyncExternalStore(read.unreadable.subscribe, read.unreadable.snapshot);
}

const subscribeNothing = () => () => {};
const snapshotNull = () => null;

export function useCharacter(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.character(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useChatDisplay(id: string, opening: Opening, screen: ChatScope['screen']) {
  const { read, talk } = useSession();
  const model = useMemo(() => read.screen(id, talk, opening), [read, talk, id]);
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  // The first layout runs before the external-store subscription; paint the viewport/greeting update without waiting for it.
  useLayoutEffect(() => {
    if (model.setInputs(opening, screen)) refresh();
  }, [model, opening.chat, opening.messages, screen?.width, screen?.height]);
  return useSyncExternalStore(model.subscribe, model.snapshot);
}

export function useTurn(): Turn | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, talk.snapshot);
}

export function useTranslating(): Translating {
  const translator = useTranslator();
  return useSyncExternalStore(translator.subscribe, translator.snapshot);
}

// The chat's stored memory, null while it has none.
export function useChatMemory(chat: string | null): Memory | null {
  const { store } = useSession();
  const id = chat === null ? null : memoryId(chat);
  const subscribe = useCallback(
    (listener: () => void) => (id === null ? () => {} : store.subscribe((changes) => changes.some((change) => change.kind === 'memory' && change.id === id) && listener())),
    [store, id],
  );
  return useSyncExternalStore(subscribe, () => (id === null ? null : store.get('memory', id)))?.value ?? null;
}

export function useRemembering(): Remembering {
  const { memory } = useSession();
  return useSyncExternalStore(memory.subscribe, memory.snapshot);
}
