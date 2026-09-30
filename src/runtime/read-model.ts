import type { Display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { chatTitle, firstLine, fold, shown, type Chat, type ChatItem, type ChatSummary, type Message } from '../model/chat';
import type { Kind, Stored } from '../model/kinds';
import { nest, shelve, type CharacterShelf, type FolderTree, type Shelf } from '../model/library';
import { SETTINGS_ID, type Settings } from '../model/settings';
import { readsChanged, type ObjectStore, type StoreChange, type StoreRead } from './store';
import { withTurn, type Shown, type Talk, type Turn } from './talk';
import { displayChat } from './turn';

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

export type ChatModel = ChatItem & { display: Display };
// The characters, each with its chats, most recent first, and the folders by name.
export type Library = { characters: CharacterShelf<ChatSummary>[]; none: Shelf<ChatSummary>; deleted: CharacterShelf<ChatSummary>[]; folders: FolderTree[] };
type HeldChat = { model: ChatModel; summary: ChatSummary; reads: StoreRead[] };
const EMPTY_SETTINGS: Settings = { models: {} };
const sameItems = <T>(left: T[], right: T[]) => left.length === right.length && left.every((item, index) => item === right[index]);
const sameSummary = (a: ChatSummary, b: ChatSummary) => a.chat === b.chat && a.count === b.count && a.title === b.title && a.preview === b.preview && a.at === b.at && a.order === b.order;

export class ReadModels {
  private readonly held = new Map<string, HeldChat>();
  private readonly byChat = new Map<string, Snapshot<ChatModel | null>>();
  private readonly bySummary = new Map<string, Snapshot<ChatSummary | null>>();
  private readonly byKind = new Map<Kind, Snapshot<Stored<Kind>[]>>();
  private readonly byCharacter = new Map<string, Snapshot<CharacterShelf<ChatSummary> | null>>();
  private folders: FolderTree[];
  private readonly screens = new Map<string, ChatScreenRead>();
  readonly chats = new Snapshot<ChatSummary[]>([]);
  readonly messages = new Snapshot<Message[][]>([]);
  readonly library: Snapshot<Library>;
  // Until something is saved, nothing is assigned: an empty layer, not a guessed default.
  readonly settings: Snapshot<Settings>;
  readonly unreadable: Snapshot<number>;
  private readonly leave: () => void;

  constructor(readonly store: ObjectStore) {
    this.folders = nest(store.list('folder'));
    this.settings = new Snapshot(store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable = new Snapshot(store.unreadable());
    for (const chat of store.list('chat')) this.rebuild(chat.id, true);
    this.updateLists();
    this.library = new Snapshot(this.buildLibrary());
    this.leave = store.subscribe((changes) => this.changed(changes));
  }

  chat(id: string): Snapshot<ChatModel | null> {
    let snapshot = this.byChat.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(this.held.get(id)?.model ?? null);
      this.byChat.set(id, snapshot);
    }
    return snapshot;
  }

  summary(id: string): Snapshot<ChatSummary | null> {
    let snapshot = this.bySummary.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(this.held.get(id)?.summary ?? null);
      this.bySummary.set(id, snapshot);
    }
    return snapshot;
  }

  kind<K extends Kind>(kind: K): Snapshot<Stored<K>[]> {
    let snapshot = this.byKind.get(kind);
    if (!snapshot) {
      snapshot = new Snapshot(this.store.list(kind));
      this.byKind.set(kind, snapshot);
    }
    return snapshot as Snapshot<Stored<K>[]>;
  }

  // The characters not in 지운 캐릭터.
  character(id: string): Snapshot<CharacterShelf<ChatSummary> | null> {
    let snapshot = this.byCharacter.get(id);
    if (!snapshot) {
      snapshot = new Snapshot(this.library.snapshot().characters.find((shelf) => shelf.id === id) ?? null);
      this.byCharacter.set(id, snapshot);
    }
    return snapshot;
  }

  screen(id: string, talk: Pick<Talk, 'snapshot' | 'subscribe'>, opening: Opening): ChatScreenRead {
    return new ChatScreenRead(this, talk, id, opening);
  }

  attach(screen: ChatScreenRead) {
    this.screens.set(screen.id, screen);
    return () => {
      if (this.screens.get(screen.id) === screen) this.screens.delete(screen.id);
    };
  }

  displayed(id: string): ScreenChat | null {
    const model = this.chat(id).snapshot();
    if (model) return { chat: model.chat, messages: withTurn(model.messages, null, id), display: model.display };
    return this.screens.get(id)?.forTranslation() ?? null;
  }

  close() {
    this.leave();
    this.screens.clear();
  }

  private rebuild(id: string, entriesChanged: boolean) {
    const stored = this.store.get('chat', id);
    if (!stored) {
      this.held.delete(id);
      this.byChat.get(id)?.set(null);
      this.bySummary.get(id)?.set(null);
      return;
    }
    const previous = this.held.get(id);
    const entries = this.store.children('entry', id);
    const messages = entriesChanged || !previous ? fold(entries) : previous.model.messages;
    const { value: display, reads } = this.store.capture(() => displayChat({ store: this.store }, id, stored.value, messages));
    const latest = entries.reduce<Stored<'entry'> | null>((last, entry) => last && last.rev > entry.rev ? last : entry, null);
    // A message is named as the reader reads it: its translation when it has one.
    const texts = display.texts.map((text, index) => shown(messages[index]!).translation?.text ?? text);
    const last = texts.at(-1);
    const next: ChatSummary = { id, chat: stored.value, count: messages.length, title: chatTitle(stored.value, messages, texts), preview: last === undefined ? '' : firstLine(last), at: latest?.value.at ?? null, order: latest?.rev ?? stored.rev };
    const summary = previous && sameSummary(previous.summary, next) ? previous.summary : next;
    const model = { ...summary, messages, display };
    this.held.set(id, { model, summary, reads });
    this.byChat.get(id)?.set(model);
    this.bySummary.get(id)?.set(summary);
  }

  private changed(changes: readonly StoreChange[]) {
    const dirty = new Map<string, boolean>();
    for (const change of changes) {
      if (change.kind === 'chat') dirty.set(change.id, dirty.get(change.id) ?? false);
      if (change.kind === 'entry' && change.parent) dirty.set(change.parent, true);
    }
    for (const [id, held] of this.held) if (readsChanged(held.reads, changes) && !dirty.has(id)) dirty.set(id, false);
    for (const [id, entries] of dirty) this.rebuild(id, entries);
    const listsChanged = this.updateLists();
    const kinds = new Set(changes.map((change) => change.kind));
    for (const [kind, snapshot] of this.byKind) {
      if (!kinds.has(kind)) continue;
      const next = this.store.list(kind);
      if (!sameItems(snapshot.snapshot(), next)) snapshot.set(next);
    }
    if (kinds.has('settings')) this.settings.set(this.store.get('settings', SETTINGS_ID)?.value ?? EMPTY_SETTINGS);
    this.unreadable.set(this.store.unreadable());
    if (kinds.has('folder')) this.folders = nest(this.store.list('folder'));
    if (listsChanged || ['character', 'avatar', 'folder'].some((kind) => kinds.has(kind))) {
      const library = this.buildLibrary();
      this.library.set(library);
      for (const [id, snapshot] of this.byCharacter) snapshot.set(library.characters.find((shelf) => shelf.id === id) ?? null);
    }
  }

  // Every chat with its messages, the one written to last first. Renaming a chat or changing its model
  // does not move it.
  private updateLists(): boolean {
    const held = [...this.held.values()].sort((a, b) => b.summary.order - a.summary.order);
    const summaries = held.map((chat) => chat.summary);
    const messages = held.map((chat) => chat.model.messages);
    if (!sameItems(messages, this.messages.snapshot())) this.messages.set(messages);
    if (sameItems(summaries, this.chats.snapshot())) return false;
    this.chats.set(summaries);
    return true;
  }

  private buildLibrary(): Library {
    const shelves = shelve(this.store.list('character'), this.store.list('avatar'), this.chats.snapshot());
    const previous = this.library?.snapshot();
    const previousShelves = new Map((previous ? [...previous.characters, ...previous.deleted, previous.none] : []).map((shelf) => [shelf.id, shelf]));
    const reuse = <T extends Shelf<ChatSummary>>(shelf: T): T => {
      const held = previousShelves.get(shelf.id);
      return held && held.character === shelf.character && held.face === shelf.face && held.order === shelf.order && sameItems(held.chats, shelf.chats) ? held as T : shelf;
    };
    const next = { characters: shelves.characters.map(reuse), deleted: shelves.deleted.map(reuse), none: reuse(shelves.none), folders: this.folders };
    return previous && sameItems(previous.characters, next.characters) && sameItems(previous.deleted, next.deleted) && previous.none === next.none && previous.folders === next.folders ? previous : next;
  }
}

export type Opening = { chat: Chat; messages: Message[] };
export type ScreenChat = { chat: Chat; messages: Shown[]; display: Display };

export class ChatScreenRead {
  private readonly state: Snapshot<ScreenChat>;
  private reads: StoreRead[] = [];
  private translationDisplay: Display | null = null;
  private screen: ChatScope['screen'] = null;
  private turn: Turn | null;
  private model: ChatModel | null;
  private readonly listeners = new Set<() => void>();
  private leave: (() => void) | null = null;

  constructor(private readonly models: ReadModels, private readonly talk: Pick<Talk, 'snapshot' | 'subscribe'>, readonly id: string, private opening: Opening) {
    this.model = models.chat(id).snapshot();
    this.turn = this.currentTurn();
    this.state = new Snapshot(this.compute());
  }

  readonly snapshot = () => this.state.snapshot();
  readonly subscribe = (listener: () => void) => {
    if (!this.leave) {
      const detach = this.models.attach(this);
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
      this.leave = () => { detach(); store(); talk(); };
      const model = this.models.chat(this.id).snapshot();
      const turn = this.currentTurn();
      if (model !== this.model || turn !== this.turn) {
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
    return changed;
  }

  // Translation has always read without a viewport; an open screen must not change which replies qualify.
  forTranslation(): ScreenChat {
    const view = this.snapshot();
    this.translationDisplay ??= this.screen === null ? view.display : displayChat({ store: this.models.store }, this.id, view.chat, view.messages);
    return { ...view, display: this.translationDisplay };
  }

  private currentTurn() {
    const turn = this.talk.snapshot();
    return turn?.chat === this.id ? turn : null;
  }

  private refresh() {
    this.translationDisplay = null;
    this.state.set(this.compute());
  }

  private compute(): ScreenChat {
    const chat = this.model ? this.model.chat : this.opening.chat;
    const messages = withTurn(this.model ? this.model.messages : this.opening.messages, this.turn, this.id);
    // CBS can read later messages and threads variables forward: always display the whole chat, never only its tail.
    if (this.model && !this.turn && this.screen === null) {
      this.reads = [];
      return { chat, messages, display: this.model.display };
    }
    const { value: display, reads } = this.models.store.capture(() => displayChat({ store: this.models.store }, this.id, chat, messages, this.screen));
    this.reads = reads;
    return { chat, messages, display };
  }
}
