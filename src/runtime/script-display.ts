import { display, type Display } from '../engine/display';
import type { Displayed, Script, Snapshot } from '../engine/lua/run';
import type { ChatScope, Missed } from '../engine/render';
import type { Chat, Message } from '../model/chat';
import type { Runner } from './lua/client';
import { luaSnapshot, scriptsOf } from './scripts';
import type { ObjectStore } from './store';
import { pinned, scopeOf } from './turn';

// What a version's text became in the bot's editDisplay pass, with the text and state it was run on.
type Held = { text: string; stamp: string; shown: string };
type Pass = { scripts: Script[]; snapshot: Snapshot; items: Missed[] };

// How long one stretch of a pass may hold the worker, which the chat's other Lua (a send, a button) waits behind. A
// script that reads the whole chat for every message takes a third of a second each on a long chat (measured
// 2026-10-02), so a pass is cut into stretches of about this long, sized by how the last one went.
const STRETCH_MS = 200;
const STRETCH_MOST = 512;

// The open chats' displays with the bot's Lua editDisplay pass laid over them (design §6.8). The display is made at
// once from what the pass has given so far; what it has not is run in the background, and the chat's listeners are
// told when it lands, to display again.
export class ScriptDisplay {
  private readonly held = new Map<string, Map<string, Held>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly waiting = new Map<string, Pass>();
  private readonly running = new Set<string>();

  constructor(
    private readonly store: ObjectStore,
    private readonly open: () => Promise<Runner>,
    // A pass's errors and the functions it called that this app lacks, or the error it ended on.
    private readonly report: (chat: string, result: Displayed | unknown) => void,
  ) {}

  // What the chat's passes gave is kept while someone listens, and dropped with the last listener.
  subscribe(chat: string, listener: () => void) {
    const listeners = this.listeners.get(chat) ?? new Set();
    this.listeners.set(chat, listeners.add(listener));
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.listeners.delete(chat);
      this.held.delete(chat);
      this.waiting.delete(chat);
    };
  }

  display(id: string, chat: Chat, messages: Message[], screen: ChatScope['screen']): Display {
    const reader = { store: this.store };
    const scope = { ...scopeOf(reader, id, chat, messages), screen };
    const take = pinned(reader, chat);
    // Only a script that names the hook can listen for it, so the others never start the worker for a display.
    const scripts = scriptsOf(scope.card).filter(({ code }) => code.includes('editDisplay'));
    if (scripts.length === 0) return display(scope, take);
    const held = this.held.get(id);
    const shown = display({ ...scope, lua: (version, text, stamp) => {
      const had = held?.get(version);
      return had ? { text: had.shown, fresh: had.text === text && had.stamp === stamp } : null;
    } }, take);
    if (shown.pass && this.listeners.has(id)) this.pass(id, { scripts, snapshot: luaSnapshot(this.store, chat, scope, shown.pass.staged, shown.pass.start), items: shown.pass.items });
    return shown;
  }

  // reloadDisplay: every pass of the chat is made again, its last result shown until then.
  stale(chat: string) {
    for (const held of this.held.get(chat)?.values() ?? []) held.stamp = '';
    this.tell(chat);
  }

  // One stretch at a time per chat, of the latest pass asked for: its newest messages, which are the ones on screen.
  // Telling the listeners displays the chat again, which asks for what is still missing, and so the next stretch; a
  // reply being written asks at every chunk.
  private pass(chat: string, pass: Pass) {
    this.waiting.set(chat, pass);
    if (this.running.has(chat)) return;
    this.running.add(chat);
    void (async () => {
      let size = 8;
      for (let next = this.waiting.get(chat); next; next = this.waiting.get(chat)) {
        this.waiting.delete(chat);
        const { scripts, snapshot } = next;
        const from = Math.max(0, next.items.length - size);
        const items = next.items.slice(from);
        const variables = new Map(snapshot.variables);
        for (const item of next.items.slice(0, from)) for (const [name, value] of item.variables) variables.set(name, value);
        const began = performance.now();
        // A pass that cannot be made shows the texts as they were, rather than nothing.
        const texts = await this.open()
          .then((runner) => runner.display(chat, scripts, { ...snapshot, variables: [...variables] }, items))
          .then(
            (shown) => (this.report(chat, shown), shown.texts),
            (error: unknown) => (this.report(chat, error), items.map((item) => item.text)),
          );
        size = Math.min(STRETCH_MOST, Math.max(1, Math.round((STRETCH_MS * items.length) / Math.max(1, performance.now() - began))));
        if (!this.listeners.has(chat)) break;
        const held = this.held.get(chat) ?? new Map<string, Held>();
        this.held.set(chat, held);
        items.forEach((item, at) => held.set(item.version, { text: item.text, stamp: item.stamp, shown: texts[at]! }));
        this.tell(chat);
      }
      this.running.delete(chat);
    })();
  }

  private tell(chat: string) {
    for (const listener of this.listeners.get(chat) ?? []) listener();
  }
}
