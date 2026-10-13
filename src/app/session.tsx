import { toolId } from '../model/tool';
import type { ToolMenu } from '../runtime/tools/facade';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react';
import type { PictureUrl } from '../engine/assets';
import type { ChatScope } from '../engine/render';
import { binned, live } from '../model/library';
import type { Kind, Stored } from '../model/kinds';
import type { AccountFacts, Standing } from '../runtime/account';
import type { Memory } from '../model/memory';
import type { Files } from '../runtime/files';
import type { Illustrating, Illustrator } from '../runtime/illustrate';
import type { Likenesses, LikenessRuns } from '../runtime/likeness';
import type { Remembering } from '../runtime/memory';
import { modulesOf } from '../runtime/modules';
import type { Session } from '../runtime/session';
import type { ChatScopeRead, Opening } from '../runtime/read-model';
import type { ScriptsState } from '../runtime/script-interactions';
import type { ObjectStore } from '../runtime/store';
import type { Talk, Turn } from '../runtime/talk';
import type { Translating, Translator } from '../runtime/translate';
import { Saves } from './common/saveQueue';

// admin, localProviders: the server's word when the account was opened (GET /session, signup, login). facts: its word since.
export type Account = { admin: boolean; localProviders: readonly string[]; facts: AccountFacts; onLock: () => void; onLogout: () => Promise<string | null> };

// A save in flight and one queued behind it are two round trips, which from Korea can take seconds each; a store write
// waiting out a dropped connection never ends on its own.
const LEAVING_WAIT = 10_000;

const SessionContext = createContext<{ session: Session; account: Account; saves: Saves } | null>(null);

export function SessionProvider({ session, account, children }: { session: Session; account: Account; children: ReactNode }) {
  // One session's save queues, closed with it: a queue kept past it would write its change into the next account.
  const saves = useMemo(() => new Saves(window, session.store.unsentWrites), [session]);
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
export const useIllustrator = (): Illustrator => useSession().illustrator;
export const useLikenesses = (): Likenesses => useSession().likenesses;

// The function is a new one when a picture has loaded, so what shows pictures renders again.
export function useAssetUrl(): PictureUrl {
  const { assets } = useSession();
  // Page keys ChatScreen by chat id (including an unsaved chat), so leaving releases this view's story, CSS and
  // status pictures together. Saving the same chat keeps its key and must not revoke its mounted pictures.
  const view = useMemo(() => assets.view(), [assets]);
  useLayoutEffect(view.hold, [view]);
  const version = useSyncExternalStore(assets.subscribe, assets.snapshot);
  return useCallback<PictureUrl>((kind, id) => view.url(kind, id), [view, version]);
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
  const scope = id === null ? null : read.scope(id);
  const { state, error } = useSyncExternalStore(scope?.subscribe ?? subscribeNothing, scope?.snapshot ?? snapshotUnloaded);
  return { model: value, state, error, retry };
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
// The account's share links, each its character's (model/share).
export const useShares = () => useKind('share');
// all is the memo's key only: it is a new array exactly when one changed.
function useLive<K extends 'prompt' | 'persona' | 'profile'>(kind: K) {
  const all = useKind(kind);
  return useMemo(() => all.filter(live), [all]);
}
export const usePrompts = () => useLive('prompt');
export const usePersonas = () => useLive('persona');
export const useProfiles = () => useLive('profile');
// A deleted one is not among them (runtime/modules modulesOf).
export function useModules() {
  const store = useStore();
  const all = useKind('module');
  return useMemo(() => modulesOf(store), [store, all]);
}
export function useBin() {
  const modules = useKind('module');
  const prompts = useKind('prompt');
  const personas = useKind('persona');
  const profiles = useKind('profile');
  return useMemo(() => ({ modules: binned(modules), prompts: binned(prompts), personas: binned(personas), profiles: binned(profiles) }), [modules, prompts, personas, profiles]);
}
// parent null is a chat not saved yet, which has none.
export function useChildren<K extends 'lore' | 'asset' | 'illustration' | 'toolchat'>(kind: K, parent: string | null): Stored<K>[] {
  const { read } = useSession();
  const model = parent === null ? null : read.children(kind, parent);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNone);
}
// A list per parent, in their order; the whole is new exactly when one list changed. key stands for parents, whose array
// a caller makes anew on each render.
export function useChildrenOf<K extends 'lore' | 'asset'>(kind: K, parents: readonly string[]): Stored<K>[][] {
  const { read } = useSession();
  const key = parents.join();
  const { subscribe, snapshot } = useMemo(() => {
    const models = parents.map((parent) => read.children(kind, parent));
    let held: Stored<K>[][] = [];
    return {
      subscribe: (listener: () => void) => {
        const stops = models.map((model) => model.subscribe(listener));
        return () => stops.forEach((stop) => stop());
      },
      snapshot: () => {
        const lists = models.map((model) => model.snapshot());
        if (lists.length !== held.length || lists.some((list, index) => list !== held[index])) held = lists;
        return held;
      },
    };
  }, [read, kind, key]);
  return useSyncExternalStore(subscribe, snapshot);
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
const NONE: never[] = [];
const snapshotNone = () => NONE;
const UNLOADED: ChatScopeRead = { state: 'unloaded', error: null };
const snapshotUnloaded = () => UNLOADED;

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
  const { read, talk, illustrator } = useSession();
  const model = useMemo(() => read.screen(id, talk, illustrator, opening), [read, talk, illustrator, id]);
  // The first layout installs viewport/greeting inputs before the external-store subscription; evaluation publishes asynchronously.
  useLayoutEffect(() => {
    model.setInputs(opening, screen);
  }, [model, opening.chat, opening.messages, screen?.width, screen?.height]);
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot);
  return useMemo(() => ({ ...snapshot, retry: () => void model.refresh(), retryRegex: () => model.retryRegex() }), [snapshot, model]);
}

export function useTurn(chat: string): Turn | null {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, () => talk.snapshot(chat));
}

export function useWritingChats(): ReadonlySet<string> {
  const talk = useTalk();
  return useSyncExternalStore(talk.subscribe, talk.writing);
}

export function useTranslating(): Translating {
  const translator = useTranslator();
  return useSyncExternalStore(translator.subscribe, translator.snapshot);
}

// null while it has none.
export function useChatMemory(id: string | null): Memory | null {
  const { read } = useSession();
  const model = id === null ? null : read.memory(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

// 삽화 runs by message: a 그리는 중 slot, or a failure with its retry.
export function useIllustrating(): Illustrating {
  const illustrator = useIllustrator();
  return useSyncExternalStore(illustrator.subscribe, illustrator.snapshot);
}

// 삽화 profiles by pack: one being made, or the failure of the last try. The profiles themselves:
// useStored('likeness', likenessId(owner)).
export function useLikenessRuns(): LikenessRuns {
  const likenesses = useLikenesses();
  return useSyncExternalStore(likenesses.subscribe, likenesses.snapshot);
}

export function useScripts(): ScriptsState {
  const { scripts } = useSession();
  return useSyncExternalStore(scripts.subscribe, scripts.snapshot);
}

export function useRemembering(): Remembering {
  const { memory } = useSession();
  return useSyncExternalStore(memory.subscribe, memory.snapshot);
}

export function useTool(module: string | null) {
  const owner = useStored('module', module);
  const tool = useStored('tool', module === null ? null : toolId(module));
  return owner && live(owner) ? tool : null;
}
export const useTools = () => useKind('tool');

export function useChatTools(chat: string | null): ToolMenu[] {
  const { read, tools } = useSession();
  const model = chat === null ? null : read.tools(chat, tools);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNone);
}
