import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatScope } from '../engine/render';
import type { Kind } from '../model/kinds';
import { memoryId, type Memory } from '../model/memory';
import type { Files } from '../runtime/files';
import type { Remembering } from '../runtime/memory';
import { modulesOf } from '../runtime/modules';
import type { Session } from '../runtime/session';
import type { Opening } from '../runtime/read-model';
import type { ScriptsState } from '../runtime/scripts';
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
  const { read, store } = useSession();
  const exists = id !== null && store.get('chat', id) !== null;
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (id === null || !exists) return;
    const lease = store.retainChat(id);
    return lease.release;
  }, [store, id, attempt, exists]);
  const model = id === null ? null : read.chat(id);
  const value = useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
  const subscribe = useCallback((listener: () => void) => store.subscribe((changes) => {
    if (changes.some((change) => change.kind === 'scope' && change.id === id)) listener();
  }), [store, id]);
  const state = useSyncExternalStore(subscribe, () => id === null ? 'unloaded' : store.scopeState(id));
  return { model: value, state, error: id === null ? null : store.scopeError(id), retry };
}

export function useChatSummary(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.summary(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useSummaries() {
  const summaries = useKind('summary');
  const chats = useChats();
  return useMemo(() => {
    const ids = new Set(chats.map((chat) => chat.id));
    return summaries.filter((summary) => summary.parent !== null && ids.has(summary.parent));
  }, [summaries, chats]);
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
// The modules there are, by name; a deleted one is not among them (runtime/modules modulesOf). all is the memo's key
// only: it is a new array exactly when a module changed.
export function useModules() {
  const store = useStore();
  const all = useKind('module');
  return useMemo(() => modulesOf(store), [store, all]);
}
// How many lorebook entries or assets something holds, such as a module. A number, since a fresh array of them would
// make React re-render forever.
export function useCount(kind: 'lore' | 'asset', parent: string): number {
  const store = useStore();
  const subscribe = useCallback((listener: () => void) => store.subscribe((changes) => changes.some((change) => change.kind === kind && change.parent === parent) && listener()), [store, kind, parent]);
  return useSyncExternalStore(subscribe, () => store.children(kind, parent).length);
}
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
  const id = chat;
  const subscribe = useCallback(
    (listener: () => void) => (id === null ? () => {} : store.subscribe((changes) => changes.some((change) => (change.kind === 'memory' || change.kind === 'scope') && change.parent === id) && listener())),
    [store, id],
  );
  return useSyncExternalStore(subscribe, () => (id === null ? null : store.children('memory', id).find((memory) => memory.id === memoryId(id)) ?? null))?.value ?? null;
}

// What the bots' scripts have said and not yet shown, and what they are asking.
export function useScripts(): ScriptsState {
  const { scripts } = useSession();
  return useSyncExternalStore(scripts.subscribe, scripts.snapshot);
}

export function useRemembering(): Remembering {
  const { memory } = useSession();
  return useSyncExternalStore(memory.subscribe, memory.snapshot);
}
