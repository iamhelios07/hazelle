import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatScope } from '../engine/render';
import { binned, live } from '../model/library';
import type { Kind, Stored } from '../model/kinds';
import type { AccountFacts, Standing } from '../runtime/account';
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
import { Saves } from './common/saveQueue';

// admin: the server's word when the account was opened (GET /session, signup, login). facts: its word since.
export type Account = { admin: boolean; facts: AccountFacts; onLock: () => void; onLogout: () => Promise<string | null> };

// How long leaving waits for the saves still on their way. A save in flight and one queued behind it are two round
// trips, which from Korea can take seconds each; a store write waiting out a dropped connection never ends on its own.
const LEAVING_WAIT = 10_000;

const SessionContext = createContext<{ session: Session; account: Account; saves: Saves } | null>(null);

export function SessionProvider({ session, account, children }: { session: Session; account: Account; children: ReactNode }) {
  // One session's save queues, closed with it: a queue kept past it would write its change into the next account.
  const saves = useMemo(() => new Saves(window), [session]);
  useEffect(() => () => saves.close(), [saves]);
  // Leaving closes the session, which drops what has not been written, so it waits for the saves first.
  const leaving = useMemo<Account>(
    () => ({
      ...account,
      onLock: () => void saves.settled(LEAVING_WAIT).then(account.onLock),
      onLogout: () => saves.settled(LEAVING_WAIT).then(account.onLogout),
    }),
    [account, saves],
  );
  return <SessionContext value={{ session, account: leaving, saves }}>{children}</SessionContext>;
}

function useOpen() {
  const open = useContext(SessionContext);
  if (!open) throw new Error('session hook outside SessionProvider');
  return open;
}

export const useSession = (): Session => useOpen().session;
export const useAccount = (): Account => useOpen().account;
export const useSaves = (): Saves => useOpen().saves;
export const useStore = (): ObjectStore => useSession().store;
export const useFiles = (): Files => useSession().files;

export function useStanding(): Standing {
  const { facts } = useAccount();
  return useSyncExternalStore(facts.subscribe, facts.snapshot);
}
export const useTalk = (): Talk => useSession().talk;
export const useTranslator = (): Translator => useSession().translator;

// A bot asset's picture URL as the session has it (runtime/assets). The function is a new one when a picture has
// loaded, so what shows pictures renders again.
export function useAssetUrl(): (id: string) => string | undefined {
  const { assets } = useSession();
  // Page keys ChatScreen by chat id (including an unsaved chat), so leaving releases this view's story, CSS and
  // status pictures together. Saving the same chat keeps its key and must not revoke its mounted pictures.
  const view = useMemo(() => assets.view(), [assets]);
  useLayoutEffect(view.hold, [view]);
  const version = useSyncExternalStore(assets.subscribe, assets.snapshot);
  return useCallback((id: string) => view.url(id), [view, version]);
}

// Every snapshot below is held until its own inputs change: fresh selector arrays would make React re-render forever.
export function useChats() {
  const { read } = useSession();
  return useSyncExternalStore(read.chats.subscribe, read.chats.snapshot);
}

export function useChatModel(id: string | null) {
  const { read, store } = useSession();
  const exists = id !== null && live(store.get('chat', id)) !== null;
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
// Those not in 휴지통. all is the memo's key only: it is a new array exactly when one changed.
function useLive<K extends 'prompt' | 'persona' | 'profile'>(kind: K) {
  const all = useKind(kind);
  return useMemo(() => all.filter(live), [all]);
}
export const usePrompts = () => useLive('prompt');
export const usePersonas = () => useLive('persona');
export const useProfiles = () => useLive('profile');
// The modules there are, by name; a deleted one is not among them (runtime/modules modulesOf).
export function useModules() {
  const store = useStore();
  const all = useKind('module');
  return useMemo(() => modulesOf(store), [store, all]);
}
// What 휴지통 lists besides the library's characters and chats, most recently deleted first.
export function useBin() {
  const modules = useKind('module');
  const prompts = useKind('prompt');
  const personas = useKind('persona');
  const profiles = useKind('profile');
  return useMemo(() => ({ modules: binned(modules), prompts: binned(prompts), personas: binned(personas), profiles: binned(profiles) }), [modules, prompts, personas, profiles]);
}
// The lorebook entries or assets something holds, such as a character or a module. The array is held until one of
// them changes, since a fresh array on every read would make React re-render forever. Subscribing reads it anew, so
// a change between the render and the subscription is not missed.
export function useChildren<K extends 'lore' | 'asset'>(kind: K, parent: string): Stored<K>[] {
  const store = useStore();
  const model = useMemo(() => {
    let held: Stored<K>[] | null = null;
    return {
      subscribe: (listener: () => void) => {
        held = null;
        return store.subscribe((changes) => {
          if (!changes.some((change) => change.kind === kind && change.parent === parent)) return;
          held = null;
          listener();
        });
      },
      snapshot: () => (held ??= store.children(kind, parent)),
    };
  }, [store, kind, parent]);
  return useSyncExternalStore(model.subscribe, model.snapshot);
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

export function useStored<K extends Kind>(kind: K, id: string | null): Stored<K> | null {
  const { read } = useSession();
  const model = id === null ? null : read.object(kind, id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useChatDisplay(id: string, opening: Opening, screen: ChatScope['screen']) {
  const { read, talk } = useSession();
  const model = useMemo(() => read.screen(id, talk, opening), [read, talk, id]);
  // The first layout installs viewport/greeting inputs before the external-store subscription; evaluation publishes asynchronously.
  useLayoutEffect(() => {
    model.setInputs(opening, screen);
  }, [model, opening.chat, opening.messages, screen?.width, screen?.height]);
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot);
  return useMemo(() => ({ ...snapshot, retry: () => void model.refresh() }), [snapshot, model]);
}

export function useTurn(): Turn | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, talk.snapshot);
}

// The chat whose reply is being written, for what only marks it: the value is the same through every streamed chunk,
// so nothing that reads it renders again until the turn starts or ends.
export function useWritingChat(): string | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, () => talk.snapshot()?.chat ?? null);
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
