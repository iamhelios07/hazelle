import type { Display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { chatTitle, type Chat, type ChatSummary, type Message } from '../model/chat';
import type { Kind, Stored, Values } from '../model/kinds';
import { indexFolders, isLive, live, nest, shelve, type CharacterShelf, type FolderContents, type FolderTree, type Shelf } from '../model/library';
import { SETTINGS_ID, type Settings } from '../model/settings';
import { EvaluationStopped } from './evaluation';
import type { ScriptDisplay } from './script-display';
import { readsChanged, type ObjectStore, type StoreChange, type StoreRead } from './store';
import { withTurn, type Shown, type Talk, type Turn } from './talk';
import { evaluateChat } from './chat-context';
import { summaryId, type ChatModel } from './summary';

class Snapshot<T> {
  private readonly listeners = new Set<() => void>();
  constructor(private value: T) {}
  readonly snapshot = () => this.value;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: T) {
    if (value === this.value) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

// byCharacter includes deleted characters, but none being purged.
export type Library = {
  characters: CharacterShelf<ChatSummary>[];
  none: Shelf<ChatSummary>;
  deleted: CharacterShelf<ChatSummary>[];
  deletedChats: ChatSummary[];
  folders: FolderTree[];
  byCharacter: ReadonlyMap<string, CharacterShelf<ChatSummary>>;
  byFolder: ReadonlyMap<string, FolderContents<ChatSummary>>;
  loose: CharacterShelf<ChatSummary>[];
};

const liveShelf = (shelf: CharacterShelf<ChatSummary> | undefined) => (shelf && isLive(shelf.character) ? shelf : null);

export type OpenDisplay = Pick<ScriptDisplay, 'display' | 'subscribe'>;

const EMPTY_SETTINGS: Settings = { models: {} };
// store.list answers in the order of the last write, so read as it comes an edited object would drop to the end of
// its list. The kinds screens list come by name instead.
const NAMED: { [K in Kind]?: (value: Values[K]) => string } = {
  connection: (value) => value.label,
  module: (value) => value.name,
  persona: (value) => value.name,
  profile: (value) => value.name,
  prompt: (value) => value.name,
};
const sameItems = <T>(left: T[], right: T[]) => left.length === right.length && left.every((item, index) => item === right[index]);
const sameSummary = (a: ChatSummary, b: ChatSummary) => a.chat === b.chat && a.count === b.count && a.title === b.title && a.preview === b.preview && a.at === b.at && a.order === b.order;
// An equal one is kept, so the lists holding it stay the same.
function place(map: Map<string, ChatSummary>, id: string, next: ChatSummary | null): boolean {
  if (!next) return map.delete(id);
  const previous = map.get(id);
  if (previous && sameSummary(previous, next)) return false;
  map.set(id, next);
  return true;
}

export class ReadModels {
  private readonly summaries = new Map<string, ChatSummary>();
  private readonly binned = new Map<string, ChatSummary>();
  private readonly byChat = new Map<string, Snapshot<ChatModel | null>>();
  private readonly bySummary = new Map<string, Snapshot<ChatSummary | null>>();
  private readonly byKind = new Map<Kind, Snapshot<Stored<Kind>[]>>();
  private readonly byObject = new Map<string, { kind: Kind; state: Snapshot<Stored<Kind> | null> }>();
  private readonly byCharacter = new Map<string, Snapshot<CharacterShelf<ChatSummary> | null>>();
  private folders: FolderTree[];
  readonly chats = new Snapshot<ChatSummary[]>([]);
  readonly library: Snapshot<Library>;
  // Until something is saved, nothing is assigned: an empty layer, not a guessed default.
  readonly settings: Snapshot<Settings>;
  readonly unreadable: Snapshot<number>;
  private readonly leave: () => void;

  constructor(
    readonly store: ObjectStore,
    readonly open: OpenDisplay = { display: (id, chat, messages, screen, signal) => evaluateChat({ store }, id, chat, messages, screen, signal), subscribe: () => () => {} },
  ) {
    this.folders = nest(store.list('folder'));
    this.settings = new Snapshot(store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable = new Snapshot(store.unreadable());
    this.updateLists();
    this.library = new Snapshot(this.buildLibrary());
    this.leave = store.subscribe((changes) => this.changed(changes));
  }

  chat(id: string): Snapshot<ChatModel | null> {
    let snapshot = this.byChat.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(this.store.projections.get(id)?.model ?? null);
      this.byChat.set(id, snapshot);
    }
    return snapshot;
  }

  summary(id: string): Snapshot<ChatSummary | null> {
    let snapshot = this.bySummary.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(this.summaries.get(id) ?? null);
      this.bySummary.set(id, snapshot);
    }
    return snapshot;
  }

  private listed<K extends Kind>(kind: K): Stored<K>[] {
    const name = NAMED[kind] as ((value: Values[K]) => string) | undefined;
    const list = this.store.list(kind);
    return name ? list.sort((a, b) => name(a.value).localeCompare(name(b.value), 'ko') || a.id.localeCompare(b.id)) : list;
  }

  kind<K extends Kind>(kind: K): Snapshot<Stored<K>[]> {
    let snapshot = this.byKind.get(kind);
    if (!snapshot) {
      snapshot = new Snapshot(this.listed(kind));
      this.byKind.set(kind, snapshot);
    }
    return snapshot as Snapshot<Stored<K>[]>;
  }

  object<K extends Kind>(kind: K, id: string): Snapshot<Stored<K> | null> {
    const key = `${kind}:${id}`;
    let object = this.byObject.get(key);
    if (!object) {
      object = { kind, state: new Snapshot(this.store.get(kind, id)) };
      this.byObject.set(key, object);
    }
    return object.state as Snapshot<Stored<K> | null>;
  }

  character(id: string): Snapshot<CharacterShelf<ChatSummary> | null> {
    let snapshot = this.byCharacter.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(liveShelf(this.library.snapshot().byCharacter.get(id)));
      this.byCharacter.set(id, snapshot);
    }
    return snapshot;
  }

  screen(id: string, talk: Pick<Talk, 'snapshot' | 'subscribe'>, opening: Opening): ChatScreenRead {
    return new ChatScreenRead(this, talk, id, opening);
  }

  async displayed(id: string): Promise<ScreenChat | null> {
    await this.store.projections.evaluate(id);
    const model = this.chat(id).snapshot();
    return model && { chat: model.chat, messages: withTurn(model.messages, null, id), display: model.display };
  }

  close() {
    this.leave();
    for (const snapshot of this.byChat.values()) snapshot.set(null);
    this.byChat.clear();
  }

  private changed(changes: readonly StoreChange[]) {
    for (const [id, snapshot] of this.byChat) snapshot.set(this.store.projections.get(id)?.model ?? null);
    const listsChanged = this.updateLists(changes);
    const kinds = new Set(changes.map((change) => change.kind));
    for (const [kind, snapshot] of this.byKind) {
      if (!kinds.has(kind)) continue;
      const next = this.listed(kind);
      if (!sameItems(snapshot.snapshot(), next)) snapshot.set(next);
    }
    if (kinds.has('settings')) this.settings.set(this.store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable.set(this.store.unreadable());
    if (kinds.has('folder')) this.folders = nest(this.store.list('folder'));
    if (listsChanged || ['character', 'avatar', 'folder'].some((kind) => kinds.has(kind))) {
      const library = this.buildLibrary();
      this.library.set(library);
      for (const [id, snapshot] of this.byCharacter) snapshot.set(liveShelf(library.byCharacter.get(id)));
    }
    for (const change of changes) {
      const object = this.byObject.get(`${change.kind}:${change.id}`);
      if (object) object.state.set(this.store.get(object.kind, change.id));
    }
  }

  // Renaming a populated chat or changing its model does not move it.
  private updateLists(changes?: readonly StoreChange[]): boolean {
    const ids = changes
      ? new Set(changes.flatMap((change) => change.kind === 'chat' ? [change.id] : change.kind === 'summary' && change.parent ? [change.parent] : []))
      : new Set(this.store.list('chat').map(({ id }) => id));
    let changed = false;
    let binChanged = false;
    for (const id of ids) {
      const stored = this.store.get('chat', id);
      const next = stored && this.summarize(stored);
      const alive = live(stored) !== null;
      if (place(this.summaries, id, alive ? next : null)) {
        this.bySummary.get(id)?.set(this.summaries.get(id) ?? null);
        changed = true;
      }
      if (place(this.binned, id, alive ? null : next)) binChanged = true;
    }
    if (changed) this.chats.set([...this.summaries.values()].sort((a, b) => b.order - a.order));
    return changed || binChanged;
  }

  private summarize({ id, value: chat, rev }: Stored<'chat'>): ChatSummary {
    const saved = this.store.get('summary', summaryId(id))?.value;
    return {
      id, chat, count: saved?.count ?? null,
      title: chat.title ?? (chat.origin ? `${chat.origin.name} · 분기` : saved?.title ?? chatTitle(chat, [], [])),
      preview: saved?.preview ?? null, at: saved?.at ?? null, order: saved?.order ?? rev,
    };
  }

  private buildLibrary(): Library {
    const shelves = shelve(this.store.list('character'), this.store.list('avatar'), this.chats.snapshot(), [...this.binned.values()]);
    const previous = this.library?.snapshot();
    const reuse = <T extends Shelf<ChatSummary>>(shelf: T): T => {
      const held = shelf.id === null ? previous?.none : previous?.byCharacter.get(shelf.id);
      return held && held.character === shelf.character && held.face === shelf.face && held.order === shelf.order && sameItems(held.chats, shelf.chats) ? held as T : shelf;
    };
    const next = { characters: shelves.characters.map(reuse), deleted: shelves.deleted.map(reuse), deletedChats: shelves.deletedChats, none: reuse(shelves.none), folders: this.folders };
    const sameCharacters = previous !== undefined && sameItems(previous.characters, next.characters);
    const sameDeleted = previous !== undefined && sameItems(previous.deleted, next.deleted);
    if (previous && sameCharacters && sameDeleted && sameItems(previous.deletedChats, next.deletedChats) && previous.none === next.none && previous.folders === next.folders) return previous;
    const byCharacter = previous && sameCharacters && sameDeleted ? previous.byCharacter : new Map([...next.characters, ...next.deleted].map((shelf) => [shelf.id, shelf]));
    const filed = previous && sameCharacters && previous.folders === next.folders ? { byFolder: previous.byFolder, loose: previous.loose } : indexFolders(next.characters, next.folders);
    return { ...next, byCharacter, ...filed };
  }
}

export type Opening = { chat: Chat; messages: Message[] };
export type ScreenChat = { chat: Chat; messages: Shown[]; display: Display; pending?: boolean; error?: unknown };

export class ChatScreenRead {
  private readonly state: Snapshot<ScreenChat>;
  private reads: StoreRead[] = [];
  private evaluation: AbortController | null = null;
  private revision = 0;
  private screen: ChatScope['screen'] = null;
  private turn: Turn | null;
  private model: ChatModel | null;
  private readonly listeners = new Set<() => void>();
  private leave: (() => void) | null = null;

  constructor(private readonly models: ReadModels, private readonly talk: Pick<Talk, 'snapshot' | 'subscribe'>, readonly id: string, private opening: Opening) {
    this.model = models.chat(id).snapshot();
    this.turn = this.currentTurn();
    this.state = new Snapshot<ScreenChat>({ chat: opening.chat, messages: [], display: { texts: [], css: '', drawn: [], boxes: [], pass: false, stopped: null }, pending: true });
  }

  readonly snapshot = () => this.state.snapshot();
  readonly subscribe = (listener: () => void) => {
    if (!this.leave) {
      // The tokenizer is loaded when a chat opens rather than with the page, a new chat not saved yet included, so a
      // first send never waits for it.
      this.models.store.evaluation.warm();
      const lease = this.models.store.retainChat(this.id);
      const store = this.models.store.subscribe((changes) => {
        const model = this.models.chat(this.id).snapshot();
        if (model === this.model && !readsChanged(this.reads, changes)) return;
        this.model = model;
        this.refresh();
      });
      const talk = this.talk.subscribe(() => {
        const turn = this.currentTurn();
        if (turn === this.turn) return;
        this.turn = turn;
        this.refresh();
      });
      const passed = this.models.open.subscribe(this.id, (display) => {
        if (!display) return this.refresh();
        this.state.set({ ...this.state.snapshot(), display });
      });
      this.leave = () => { this.revision++; this.evaluation?.abort(); store(); talk(); passed(); lease.release(); };
      const model = this.models.chat(this.id).snapshot();
      const turn = this.currentTurn();
      // A pass the display was missing while nobody listened was not run: it is asked for again now.
      if (model !== this.model || turn !== this.turn || this.state.snapshot().display.pass || this.state.snapshot().pending) {
        this.model = model;
        this.turn = turn;
        this.refresh();
      }
    }
    const unsubscribe = this.state.subscribe(listener);
    this.listeners.add(listener);
    return () => {
      unsubscribe();
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.leave?.(); this.leave = null; }
    };
  };

  setInputs(opening: Opening, screen: ChatScope['screen']) {
    const changed = this.screen?.width !== screen?.width || this.screen?.height !== screen?.height || (!this.model && (opening.chat !== this.opening.chat || opening.messages !== this.opening.messages));
    this.opening = opening;
    this.screen = screen;
    if (changed) this.refresh();
  }

  private currentTurn() {
    return this.talk.snapshot(this.id);
  }

  refresh() {
    this.evaluation?.abort();
    const evaluation = new AbortController();
    this.evaluation = evaluation;
    const revision = ++this.revision;
    const chat = this.model ? this.model.chat : this.opening.chat;
    const messages = withTurn(this.model ? this.model.messages : this.opening.messages, this.turn, this.id);
    const { value, reads } = this.models.store.capture(() => this.models.open.display(this.id, chat, messages, this.screen, evaluation.signal));
    this.reads = reads;
    return value.then((display) => {
      if (evaluation.signal.aborted || revision !== this.revision) return;
      this.state.set({ chat, messages, display });
    }, (error: unknown) => {
      if (evaluation.signal.aborted || revision !== this.revision || error instanceof EvaluationStopped) return;
      this.state.set({ ...this.state.snapshot(), error });
    });
  }
}
