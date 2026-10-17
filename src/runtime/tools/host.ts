import { ChangeSignal } from '../../change-signal';
import type { HttpRequest } from '../../connectors/types';
import { isRecord } from '../../connectors/values';
import { RELAY_HEADER } from '../../contracts/http';
import { Runaway } from '../../engine/cbs/evaluate';
import type { ToolEvent, ToolReach, ModelMessage, Question } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import { live } from '../../model/library';
import { toolId, toolVar, type Tool, type ToolUnit } from '../../model/tool';
import type { Json } from '../../tool-api/manifest';
import type { ChatHeader, Down, EventName, Message, ToolOutcome } from '../../tool-api/protocol';
import type { ToolState } from '../evaluation-core';
import { changedTail } from '../history-delta';
import type { ScriptOutcome } from '../lua/event';
import type { Scripts } from '../scripts';
import { aborted, noOutcome, ToolStopped, ToolStuck, until, type Binding } from '../script-binding';
import type { Session } from '../session';
import type { StoreChange } from '../object-index';
import { Heartbeat } from '../worker';
import type { MenuItem, ToolFrames, ToolHosts, ToolMenu, ToolPage, ToolSlot, Tools } from './facade';
import { toolFrame, type Connection, type OpenFrame } from './frame';
import { decodeState, encodeState } from './state';
import { toolChatData, toolChatKeys, toolData, toolKeys, toolsOf, ToolWrites } from './store';

// event: absent for a page's own calls and writes.
type Context = { chat: string; scope: ChatScope; host: ToolReach; signal: AbortSignal; state?: Promise<ToolState>; event?: ToolEvent['kind'] };
type Pending = Context & { cancel: AbortController; resolve(outcome: ScriptOutcome): void; reject(error: Error): void; stop(): void };
type Frame = {
  id: number; entry: Entry; connection: Connection; page?: ToolPage; closing: AbortController; heart: Heartbeat;
  loaded: boolean; ready: Promise<void>; resolve(): void; reject(error: Error): void; loadTimer: ReturnType<typeof setTimeout> | null;
  listens: Set<EventName>; pending: Map<number, Pending>; calls: Map<number, AbortController>; messages: Message[];
  reading: Promise<unknown>; lanes: Set<string>; release(): void;
  // Opened with the sandbox's network variant (pictures and fonts from outside), fixed for the frame's life.
  network: boolean;
};
// A frame tool (manifest.risu) runs as its background frame, with these: chat, the chat open for it, which its calls
// outside an event read; menu, what its frame registered; shown, whether it asks to be shown; slot, where it is;
// leaving, a slot that showed it left in this commit, so a slot attached before the commit ends is a remount.
type Entry = {
  module: string; tool: Tool; settings: string; background: Frame | null; pages: Set<Frame>; chats: Set<string>; idle: ReturnType<typeof setTimeout> | null; data: Map<string, { key: string; json: string }>;
  chat: string | null; menu: MenuItem[]; shown: boolean; slot: ToolSlot | null; leaving: boolean;
};
const EVENTS = new Set<EventName>(['reply', 'replying', 'prompt', 'change', 'branch', 'menu', 'action', 'settings', 'open', 'message']);
const IDLE_MS = 10 * 60_000;
const STUCK_MS = 8000;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
const framesOf = (entry: Entry) => [...(entry.background ? [entry.background] : []), ...entry.pages];
const isFrameTool = (tool: Tool) => tool.manifest.risu !== undefined;
const isMenu = (value: unknown): value is MenuItem[] => Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string');

function isJson(value: unknown): value is Json {
  try { JSON.stringify(value); } catch { return false; }
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (next === null || typeof next === 'string' || typeof next === 'boolean') continue;
    if (typeof next === 'number' && Number.isFinite(next)) continue;
    if (typeof next !== 'object' || !next || (!Array.isArray(next) && Object.getPrototypeOf(next) !== Object.prototype && Object.getPrototypeOf(next) !== null)) return false;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const value of Object.values(next)) pending.push(value);
  }
  return true;
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) return false;
  if (value.kind === 'input' || value.kind === 'confirm') return typeof value.text === 'string';
  return value.kind === 'select' && (value.text === undefined || typeof value.text === 'string') && Array.isArray(value.options) && value.options.every((option) => typeof option === 'string');
}
function isModelMessages(value: unknown): value is ModelMessage[] {
  return Array.isArray(value) && value.every((message) => isRecord(message) && (message.role === 'system' || message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
}
// The relay's envelope, less the URL: GET or POST, text headers, and a text body only with POST.
function isRequest(value: unknown): value is Omit<HttpRequest, 'url'> {
  return isRecord(value) && (value.method === 'GET' || value.method === 'POST') && isRecord(value.headers) && Object.values(value.headers).every((each) => typeof each === 'string')
    && (value.body === null || (value.method === 'POST' && typeof value.body === 'string'));
}
const isPairs = (value: unknown) => Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (pair[1] === undefined || isJson(pair[1])));
const isText = (value: unknown) => value === undefined || value === null || typeof value === 'string';
function isAnswer(value: unknown): value is Hazelle.PromptAnswer | undefined {
  if (isText(value)) return true;
  if (!isRecord(value) || !isText(value.tool)) return false;
  return value.memory === undefined || (isRecord(value.memory) && typeof value.memory.text === 'string' && (value.memory.through === null || typeof value.memory.through === 'string'));
}
function isOutcome(value: unknown): value is ToolOutcome {
  return isRecord(value) && isAnswer(value.value) && isPairs(value.writes) && isPairs(value.data)
    && Array.isArray(value.edits) && value.edits.every((edit) => isRecord(edit) && Number.isInteger(edit.index) && typeof edit.text === 'string')
    && Array.isArray(value.added) && value.added.every((item) => isRecord(item) && (item.role === 'user' || item.role === 'char') && typeof item.text === 'string')
    && Array.isArray(value.badges) && value.badges.every((badge) => isRecord(badge) && Number.isInteger(badge.index) && (badge.text === null || typeof badge.text === 'string'));
}
const eventFields = (event: ToolEvent): Partial<Extract<Down, { kind: 'event' }>> => {
  switch (event.kind) {
    case 'reply': return { reply: event.reply };
    case 'replying': return { text: event.text };
    case 'prompt': return { turn: event.turn };
    case 'change': return { change: event.change };
    case 'branch': return { from: event.from };
    case 'menu': return { item: event.item };
    case 'action': return { item: event.item, message: event.message };
  }
};
function cardOf(character: string | null, scope: ChatScope): Hazelle.Card | null {
  const { card } = scope;
  if (!card || character === null) return null;
  const lore = scope.lore.filter(({ parent }) => parent === character).map(({ value }) => ({ name: value.name, keys: value.keys, text: value.content, always: value.constant, on: value.enabled }));
  return { id: character, name: card.name, description: card.description, personality: card.personality, scenario: card.scenario, greeting: card.greetings[0] ?? null, creatorNotes: card.creatorNotes, tags: card.tags, lore };
}
const header = (chat: string, scope: ChatScope): ChatHeader => ({ id: chat, character: scope.card && { name: scope.card.name, description: scope.card.description }, persona: scope.persona, length: scope.messages.length - (scope.greeting === null ? 0 : 1) });

export class ToolHost implements Tools, Binding<ToolUnit, ToolEvent, ToolReach> {
  private readonly entries = new Map<string, Entry>();
  private readonly code = new Map<string, Promise<string>>();
  private readonly stalls = new Map<string, number>();
  private readonly writes: ToolWrites;
  private readonly closing = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly signal = new ChangeSignal();
  private shownFrames: ToolFrames = new Map();
  private called: ToolHosts = new Map();
  private ids = 0;

  constructor(private readonly session: Pick<Session, 'store' | 'files'>, private readonly scripts: () => Pick<Scripts, 'report' | 'pageContext' | 'pageWrite'>, private readonly open: OpenFrame = toolFrame) {
    this.writes = new ToolWrites(session.store);
    this.unsubscribe = session.store.subscribe((changes) => this.changed(changes));
  }

  menus(chat: string): ToolMenu[] {
    const stored = live(this.session.store.get('chat', chat));
    return stored ? toolsOf(this.session.store, stored.value).map(({ module, tool }) => ({ module, manifest: tool.manifest })) : [];
  }

  readonly items = (module: string): MenuItem[] => {
    const tool = this.session.store.get('tool', toolId(module))?.value;
    if (!tool) return [];
    return isFrameTool(tool) ? this.entries.get(module)?.menu ?? [] : tool.manifest.menu;
  };

  readonly subscribe = (listener: () => void) => this.signal.subscribe(listener);
  readonly frames = () => this.shownFrames;
  readonly hosts = () => this.called;

  private publish() {
    this.shownFrames = new Map([...this.entries.values()].filter((entry) => isFrameTool(entry.tool)).map((entry) => [entry.module, { menu: entry.menu, chat: entry.chat, asking: entry.shown && !entry.slot }]));
    this.signal.notify();
  }

  async warm(chat: string): Promise<void> {
    await Promise.all(this.menus(chat).map(async ({ module }) => {
      try {
        const entry = this.entry(module);
        entry.chats.add(chat);
        if (isFrameTool(entry.tool) && entry.chat !== chat) { entry.chat = chat; this.publish(); }
        await this.background(entry);
      }
      catch (error) { this.scripts().report(chat, error, { kind: 'module', id: module }); }
    }));
  }

  async run(chat: string, unit: ToolUnit, scope: ChatScope, event: ToolEvent, host: ToolReach, signal?: AbortSignal): Promise<ScriptOutcome> {
    const entry = this.entry(unit.module);
    if (entry.tool.file.id !== unit.tool.file.id || !this.allowed(chat, entry.module)) throw new ToolStopped();
    entry.chats.add(chat);
    this.idle(entry);
    const frame = await until(this.background(entry), signal);
    if (!frame.listens.has(event.kind)) return noOutcome();
    const cancel = new AbortController();
    const stop = AbortSignal.any([cancel.signal, frame.closing.signal, ...(signal ? [signal] : [])]);
    if (stop.aborted) throw aborted(stop);
    const id = ++this.ids;
    return new Promise<ScriptOutcome>((resolve, reject) => {
      const abort = () => { frame.pending.delete(id); reject(aborted(stop)); this.idle(entry); };
      stop.addEventListener('abort', abort, { once: true });
      frame.pending.set(id, { chat, scope, host, signal: stop, cancel, resolve, reject, stop: () => stop.removeEventListener('abort', abort), event: event.kind });
      this.idle(entry);
      this.send(frame, { kind: 'event', id, event: event.kind, chat: header(chat, scope), ...eventFields(event) });
    });
  }

  page(module: string, page: ToolPage): () => void {
    let frame: Frame;
    try {
      const entry = this.entry(module);
      if (!entry.tool.manifest.page || (page.chat !== null && !this.allowed(page.chat, module))) throw new ToolStopped();
      if (page.chat !== null) entry.chats.add(page.chat);
      frame = this.frame(entry, page);
      entry.pages.add(frame);
      this.idle(entry);
      void frame.ready.catch((error: unknown) => this.scripts().report(page.chat ?? '', error, { kind: 'module', id: module }));
    } catch (error) {
      this.scripts().report(page.chat ?? '', error, { kind: 'module', id: module });
      page.close();
      return () => {};
    }
    return () => { this.endFrame(frame, new ToolStopped()); this.idle(frame.entry); };
  }

  // The frame is shown over slot while it asks to be; a slot attached while it does not is the user opening its page.
  attach(module: string, slot: ToolSlot): () => void {
    let entry: Entry;
    try {
      entry = this.entry(module);
      if (!isFrameTool(entry.tool) || (slot.chat !== null && !this.allowed(slot.chat, module))) throw new ToolStopped();
    } catch (error) {
      this.scripts().report(slot.chat ?? '', error, { kind: 'module', id: module });
      slot.close();
      return () => {};
    }
    if (slot.chat !== null) { entry.chats.add(slot.chat); entry.chat = slot.chat; }
    if (entry.leaving) { entry.leaving = false; entry.shown = true; }
    const previous = entry.slot;
    entry.slot = slot;
    previous?.place(null);
    previous?.close();
    this.idle(entry);
    this.publish();
    void this.background(entry).then((frame) => {
      if (entry.slot !== slot) return;
      if (entry.shown) slot.place(frame.connection.frame);
      else this.send(frame, { kind: 'open' });
    }, (error: unknown) => this.scripts().report(slot.chat ?? '', error, { kind: 'module', id: module }));
    return () => {
      if (entry.slot !== slot) return;
      entry.slot = null;
      slot.place(null);
      // A slot replaced within the same commit is a remount (StrictMode, a resize across layouts), not the user closing
      // it. shown drops now, so no other tool's panel is pushed aside meanwhile, and a remount restores it.
      if (entry.shown) {
        entry.leaving = true;
        queueMicrotask(() => { entry.leaving = false; });
      }
      entry.shown = false;
      this.idle(entry);
      this.publish();
    };
  }

  private settingsChanged(entry: Entry, tool: Tool) {
    const settings = JSON.stringify(tool.settings);
    if (settings === entry.settings) return;
    entry.settings = settings;
    entry.tool = tool;
    if (entry.background?.loaded) this.send(entry.background, { kind: 'settings', values: tool.settings });
    this.idle(entry);
  }

  close() {
    this.closing.abort();
    this.unsubscribe();
    for (const entry of [...this.entries.values()]) this.end(entry, new ToolStopped());
    this.signal.clear();
    this.writes.close();
    this.code.clear();
  }

  private allowed(chat: string, module: string): boolean {
    const stored = live(this.session.store.get('chat', chat));
    return !!stored && toolsOf(this.session.store, stored.value).some((unit) => unit.module === module);
  }

  private entry(module: string): Entry {
    if (this.closing.signal.aborted) throw new ToolStopped();
    if ((this.stalls.get(module) ?? 0) >= 3) throw new ToolStuck(true);
    const { store } = this.session;
    const tool = store.get('tool', toolId(module))?.value;
    if (!tool || !live(store.get('module', module))) throw new ToolStopped();
    const current = this.entries.get(module);
    if (current) return current;
    const entry: Entry = {
      module, tool, settings: JSON.stringify(tool.settings), background: null, pages: new Set(), chats: new Set(), idle: null,
      data: new Map(store.children('tooldata', module).map(({ id, value }) => [id, { key: value.key, json: JSON.stringify(value.value) }])),
      chat: null, menu: [], shown: false, slot: null, leaving: false,
    };
    this.entries.set(module, entry);
    return entry;
  }

  private async background(entry: Entry): Promise<Frame> {
    const frame = entry.background ??= this.frame(entry);
    await frame.ready;
    return frame;
  }

  private frame(entry: Entry, page?: ToolPage): Frame {
    // A consent given while the frame runs widens it only at its next start: restarting would drop the call that asked.
    const network = !page && isFrameTool(entry.tool) && this.networkOn(entry);
    const connection = this.open(page ? { role: 'page', page } : isFrameTool(entry.tool) ? { role: 'frame', network } : { role: 'background' });
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const lease = page?.chat ? this.session.store.retainChat(page.chat) : null;
    const frame: Frame = {
      id: ++this.ids, entry, connection, page, closing: new AbortController(),
      heart: new Heartbeat(() => this.send(frame, { kind: 'ping' }), () => this.stalled(frame)),
      loaded: false, ready, resolve, reject, loadTimer: null,
      listens: new Set(), pending: new Map(), calls: new Map(), messages: [], reading: Promise.resolve(), lanes: new Set(), release: () => lease?.release(), network,
    };
    connection.port.onmessage = ({ data }: MessageEvent<unknown>) => this.receive(frame, data);
    connection.port.start();
    void Promise.all([connection.ready, this.source(entry.tool), lease?.ready]).then(([, code, failure]) => {
      if (failure) throw new Error(failure.error);
      if (frame.closing.signal.aborted) return;
      const context = page?.chat ? this.scripts().pageContext(page.chat, entry.module, frame.closing.signal) : null;
      if (page?.chat && !context) throw new ToolStopped();
      frame.loadTimer = setTimeout(() => this.stalled(frame), STUCK_MS);
      frame.heart.start(STUCK_MS);
      this.send(frame, { kind: 'load', api: 1, role: page ? 'page' : isFrameTool(entry.tool) ? 'frame' : 'background', code, manifest: entry.tool.manifest, settings: entry.tool.settings, chat: context ? header(page!.chat!, context.scope) : null, theme: page?.theme ?? 'dark' });
    }).catch((error: unknown) => this.endFrame(frame, error instanceof Error ? error : new Error(String(error)), true));
    return frame;
  }

  private source(tool: Tool): Promise<string> {
    const held = this.code.get(tool.file.id);
    if (held) return held;
    const reading = this.session.files.read(tool.file, { signal: this.closing.signal }).then((read) => {
      if (!read.ok) throw new Error(`Tool file: ${read.error}`);
      return new TextDecoder('utf-8', { fatal: true }).decode(read.data);
    }).catch((error: unknown) => { this.code.delete(tool.file.id); throw error; });
    this.code.set(tool.file.id, reading);
    return reading;
  }

  private receive(frame: Frame, data: unknown) {
    if (frame.closing.signal.aborted || !isRecord(data)) return;
    if (data.kind === 'pong') { frame.heart.answered(); return; }
    if (data.kind === 'loaded' && !frame.loaded && frame.loadTimer !== null && Array.isArray(data.listens) && data.listens.every((event) => EVENTS.has(event as EventName))) {
      frame.listens = new Set(data.listens as EventName[]);
      frame.loaded = true;
      clearTimeout(frame.loadTimer);
      frame.loadTimer = null;
      this.stalls.delete(frame.entry.module);
      frame.resolve();
      this.idle(frame.entry);
      return;
    }
    if (data.kind === 'load-failed' && typeof data.message === 'string') { this.endFrame(frame, new Error(data.message), true); return; }
    if (data.kind === 'call' && Number.isSafeInteger(data.call) && Number(data.call) > 0 && typeof data.method === 'string' && Array.isArray(data.args)) {
      const call = Number(data.call);
      if (frame.calls.has(call)) return;
      if (frame.calls.size >= 128) { this.send(frame, { kind: 'answer', call, ok: false, value: 'too-many-calls' }); return; }
      const cancel = new AbortController();
      frame.calls.set(call, cancel);
      void this.call(frame, data.method, data.args, data.event, cancel.signal).then(
        (value) => this.send(frame, { kind: 'answer', call, ok: true, value }),
        (error: unknown) => this.send(frame, { kind: 'answer', call, ok: false, value: describe(error) }),
      ).finally(() => frame.calls.delete(call));
      return;
    }
    if (data.kind === 'cancel' && Number.isSafeInteger(data.call)) { frame.calls.get(Number(data.call))?.abort(); return; }
    if (data.kind === 'done' || data.kind === 'failed') {
      const id = Number(data.id);
      if (!Number.isSafeInteger(data.id)) return;
      if (id === 0) {
        if (data.kind === 'failed' && typeof data.message === 'string') this.scripts().report(this.chatOf(frame) ?? '', new Error(data.message), { kind: 'module', id: frame.entry.module });
        else if (data.kind === 'done' && this.chatOf(frame)) {
          void this.pageWrite(frame, data.outcome).then(
            () => this.send(frame, { kind: 'answer', call: 0, ok: true, value: null }),
            (error: unknown) => this.send(frame, { kind: 'answer', call: 0, ok: false, value: describe(error) }),
          );
        }
        return;
      }
      const pending = frame.pending.get(id);
      if (!pending) return;
      if (data.kind === 'failed') { this.settle(frame, id, new Error(typeof data.message === 'string' ? data.message : 'Tool failed')); return; }
      void this.convert(frame, pending, data.outcome).then((outcome) => this.settle(frame, id, outcome), (error: unknown) => this.settle(frame, id, error instanceof Error ? error : new Error(String(error))));
    }
  }

  private settle(frame: Frame, id: number, result: ScriptOutcome | Error) {
    const pending = frame.pending.get(id);
    if (!pending) return;
    frame.pending.delete(id);
    pending.stop();
    pending.cancel.abort(result instanceof Error ? result : new ToolStopped());
    if (result instanceof Error) pending.reject(result);
    else if (!this.allowed(pending.chat, frame.entry.module)) pending.reject(new ToolStopped());
    else pending.resolve(result);
    this.idle(frame.entry);
  }

  private context(frame: Frame, event: unknown): Context {
    if (event !== undefined) {
      const pending = typeof event === 'number' ? frame.pending.get(event) : null;
      if (!pending || !this.allowed(pending.chat, frame.entry.module)) throw new ToolStopped();
      return pending;
    }
    const chat = this.chatOf(frame);
    const context = chat && this.scripts().pageContext(chat, frame.entry.module, frame.closing.signal);
    if (!context || !chat) throw new Error('no-chat');
    return { ...context, chat, signal: frame.closing.signal };
  }

  // The chat a page or a frame tool's calls outside an event act on.
  private chatOf(frame: Frame): string | null {
    return frame.page ? frame.page.chat : frame.entry.background === frame && isFrameTool(frame.entry.tool) ? frame.entry.chat : null;
  }

  private async call(frame: Frame, method: string, args: unknown[], event: unknown, cancel: AbortSignal): Promise<unknown> {
    const entry = frame.entry;
    if (!live(this.session.store.get('module', entry.module))) throw new ToolStopped();
    const [first, second] = args;
    const own = !frame.page && isFrameTool(entry.tool);
    switch (method) {
      case 'frame.chat': {
        if (!own) break;
        const chat = this.chatOf(frame);
        const context = chat && this.scripts().pageContext(chat, entry.module, frame.closing.signal);
        return context ? header(chat, context.scope) : null;
      }
      case 'frame.show':
        if (!own) break;
        entry.shown = true;
        entry.slot?.place(frame.connection.frame);
        this.publish();
        return;
      case 'frame.hide':
        if (!own) break;
        entry.shown = false;
        entry.slot?.place(null);
        entry.slot?.close();
        this.publish();
        return;
      case 'frame.menu':
        if (!own || !isMenu(first)) break;
        entry.menu = first.map(({ id, label }) => ({ id, label }));
        this.publish();
        return;
      case 'frame.missing': {
        if (!own || typeof first !== 'string') break;
        const from = { kind: 'module', id: entry.module } as const;
        const log = { stage: 'call', pack: from, script: entry.tool.manifest.displayName, at: Date.now(), duration: 0, logs: [], writes: [], errors: [], missing: [first], stopped: false, changed: false, handled: false, truncated: false };
        this.scripts().report(entry.chat ?? '', { errors: [], missing: [first], trace: { entries: [log], omitted: 0 } }, from);
        return;
      }
      case 'storage.get': if (typeof first === 'string') return toolData(this.session.store, entry.module, first); break;
      case 'storage.keys': return toolKeys(this.session.store, entry.module);
      case 'storage.set': if (typeof first === 'string' && isJson(second)) return this.writes.write(entry.module, first, second); break;
      case 'storage.delete': if (typeof first === 'string') return this.writes.write(entry.module, first, undefined); break;
      case 'settings': return this.session.store.get('tool', toolId(entry.module))!.value.settings;
      case 'post':
        if (isJson(first)) {
          if (frame.page) this.send(await this.background(entry), { kind: 'message', data: first });
          else for (const page of entry.pages) this.send(page, { kind: 'message', data: first });
          return;
        }
        break;
      case 'page.close': if (frame.page) { this.endFrame(frame, new ToolStopped(), true); this.idle(entry); return; } break;
      default: {
        const context = this.context(frame, event);
        const owner = { kind: 'module', id: entry.module } as const;
        if (method === 'chat.messages') {
          const state = await this.state(frame, context);
          const greeting = context.scope.greeting === null ? 0 : 1;
          const messages: Message[] = context.scope.messages.slice(greeting).map((message, index) => ({ index, id: message.message, version: message.id, role: message.role === 'user' ? 'user' : 'char', text: state.texts[index + greeting]!, time: message.time ?? 0 }));
          const tail = changedTail(frame.messages, messages, (a, b) => a.id === b.id && a.version === b.version && a.role === b.role && a.text === b.text && a.time === b.time);
          frame.messages = messages;
          return tail;
        }
        if (method === 'chat.card') return cardOf(live(this.session.store.get('chat', context.chat))?.value.character ?? null, context.scope);
        if (method === 'chat.greeting') return context.scope.greeting === null ? null : (await this.state(frame, context)).texts[0]!;
        if (method === 'chat.state.get' && typeof first === 'string') return decodeState(new Map((await this.state(frame, context)).variables).get(toolVar(entry.tool.manifest, first)));
        if (method === 'chat.data.get' && typeof first === 'string') return toolChatData(this.session.store, entry.module, context.chat, first);
        if (method === 'chat.data.keys') return toolChatKeys(this.session.store, entry.module, context.chat);
        if (method === 'embed' && Array.isArray(first) && first.every((text) => typeof text === 'string') && (second === null || second === 'query' || second === 'document')) {
          if (!entry.tool.manifest.uses.includes('embed')) return { ok: false, reason: 'not-declared' };
          return context.host.embed(first as string[], second, owner, context.signal);
        }
        if (method === 'model' && (first === 'main' || first === 'aux') && isModelMessages(second)) {
          if (!entry.tool.manifest.uses.includes('model')) return { ok: false, reason: 'not-declared' };
          const result = await context.host.model(first, second.map(({ role, content }) => ({ role, content })), owner, context.signal);
          return result.success ? { ok: true, text: result.result } : { ok: false, reason: result.reason };
        }
        if (method === 'fetch' && typeof first === 'string' && URL.canParse(first) && isRequest(second)) {
          if (!entry.tool.manifest.uses.includes('network')) return { ok: false, reason: 'not-declared' } satisfies Hazelle.FetchAnswer;
          return this.fetch(entry, context, { url: first, ...second }, cancel);
        }
        if (method === 'tokens' && typeof first === 'string') return context.host.tokens(first);
        if (method === 'lore' && (first === null || typeof first === 'number' && Number.isFinite(first) && first >= 0)) return context.host.lore(first);
        if (method === 'ask' && isQuestion(first)) return context.host.ask(first, owner, context.signal);
        if (method === 'say' && (first === 'normal' || first === 'error') && typeof second === 'string') return context.host.say(first, second, owner);
      }
    }
    throw new Error('Invalid tool call');
  }

  private async fetch(entry: Entry, context: Context, request: HttpRequest, cancel: AbortSignal): Promise<Hazelle.FetchAnswer> {
    const signal = AbortSignal.any([context.signal, cancel]);
    const result = await context.host.fetch(request, entry.module, signal);
    if (result.ok || (result.reason !== 'not-allowed' && result.reason !== 'stopped')) this.tally(entry.module, new URL(request.url).hostname);
    if (!result.ok) return result;
    const { response } = result;
    try {
      return { ok: true, status: response.status, headers: [...response.headers].filter(([name]) => name !== RELAY_HEADER), body: await response.arrayBuffer() };
    } catch {
      return { ok: false, reason: signal.aborted ? 'stopped' : 'offline' };
    }
  }

  private tally(module: string, host: string) {
    const hosts = new Map(this.called.get(module));
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    this.called = new Map([...this.called, [module, hosts]]);
    this.signal.notify();
  }

  private networkOn(entry: Entry): boolean {
    return entry.tool.manifest.uses.includes('network') && live(this.session.store.get('module', entry.module))?.value.network === true;
  }

  private state(frame: Frame, context: Context): Promise<ToolState> {
    if (context.state) return context.state;
    const lane = { asker: 'tool', chat: context.chat, tool: `${frame.entry.module}:${frame.id}` } as const;
    frame.lanes.add(context.chat);
    // Concurrent events have immutable snapshots but one ordered changed-tail transport per frame.
    const reading = frame.reading.catch(() => {}).then(async () => {
      const state = await this.session.store.evaluation.state(lane, context.scope, toolVar(frame.entry.tool.manifest, ''), context.signal);
      if ('kind' in state) throw new Runaway();
      return state;
    });
    frame.reading = reading.catch(() => {});
    context.state = reading;
    return reading;
  }

  private async convert(frame: Frame, context: Context, value: unknown): Promise<ScriptOutcome> {
    if (!isOutcome(value)) throw new Error('Invalid tool outcome');
    const greeting = context.scope.greeting === null ? 0 : 1;
    const edits = value.edits.filter(({ index }) => index >= 0 && index < context.scope.messages.length - greeting);
    const state = edits.length ? await this.state(frame, context) : null;
    const data = [...new Map(value.data)];
    const badges = [...new Map(value.badges.map(({ index, text }) => [index, text]))].map(([index, text]) => ({ index, text }));
    // A page's write takes its share of the write rate before it is converted (pageWrite).
    if (context.event && (data.length || badges.length)) this.writes.take(frame.entry.module);
    // The sandbox refuses these in an event about the user's own change; a page that posts its own outcome is not trusted to.
    const story = context.event === 'change' || context.event === 'branch' || context.event === 'replying' ? { edits: [], added: [] } : { edits: edits.map((edit) => ({ ...edit, wrote: state!.wrote[edit.index + greeting]! })), added: value.added.map((item) => ({ ...item, before: null })) };
    return { ...noOutcome(), value: value.value, handled: true, writes: [...new Map(value.writes)].map(([key, json]) => [toolVar(frame.entry.tool.manifest, key), encodeState(json)]), ...story, tool: { data, badges } };
  }

  private async pageWrite(frame: Frame, value: unknown) {
    this.writes.take(frame.entry.module);
    const context = this.context(frame, undefined);
    const outcome = await this.convert(frame, context, value);
    if (!frame.closing.signal.aborted) await this.scripts().pageWrite(context.chat, frame.entry.module, outcome);
  }

  private send(frame: Frame, message: Down) { if (!frame.closing.signal.aborted) frame.connection.port.postMessage(message); }

  private idle(entry: Entry) {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = null;
    // A frame tool lives while a chat is open for it or its page shows it.
    if (entry.pages.size || entry.slot || entry.chat !== null || framesOf(entry).some((frame) => frame.pending.size)) return;
    entry.idle = setTimeout(() => this.end(entry, new ToolStopped()), IDLE_MS);
  }

  private stalled(frame: Frame) {
    if (frame.closing.signal.aborted) return;
    this.stalls.set(frame.entry.module, (this.stalls.get(frame.entry.module) ?? 0) + 1);
    const error = new ToolStuck(this.stalls.get(frame.entry.module)! >= 3);
    if (frame.loaded && !framesOf(frame.entry).some((each) => each.pending.size)) this.scripts().report([...frame.entry.chats].at(-1) ?? '', error, { kind: 'module', id: frame.entry.module });
    this.end(frame.entry, error);
  }

  private endFrame(frame: Frame, error: Error, closePage = false) {
    if (frame.closing.signal.aborted) return;
    frame.closing.abort(error);
    if (frame.loadTimer !== null) clearTimeout(frame.loadTimer);
    frame.heart.rest();
    frame.connection.port.onmessage = null;
    frame.connection.close();
    frame.reject(error);
    for (const pending of frame.pending.values()) { pending.stop(); pending.reject(error); }
    frame.pending.clear();
    frame.release();
    for (const chat of frame.lanes) this.session.store.evaluation.forget({ asker: 'tool', chat, tool: `${frame.entry.module}:${frame.id}` });
    frame.entry.pages.delete(frame);
    if (frame.entry.background === frame) {
      frame.entry.background = null;
      frame.entry.menu = [];
      frame.entry.shown = false;
      if (frame.entry.slot) {
        const { slot } = frame.entry;
        frame.entry.slot = null;
        slot.place(null);
        slot.close();
      }
      this.publish();
    }
    if (closePage) frame.page?.close();
  }

  private end(entry: Entry, error: Error) {
    if (entry.idle) clearTimeout(entry.idle);
    for (const frame of framesOf(entry)) this.endFrame(frame, error, true);
    this.writes.cancel(entry.module);
    if (this.entries.get(entry.module) === entry) this.entries.delete(entry.module);
    this.publish();
  }

  private changed(changes: readonly StoreChange[]) {
    for (const entry of [...this.entries.values()]) {
      const tool = this.session.store.get('tool', toolId(entry.module))?.value;
      if (!tool || !live(this.session.store.get('module', entry.module)) || tool.file.id !== entry.tool.file.id || JSON.stringify(tool.manifest) !== JSON.stringify(entry.tool.manifest)) { this.end(entry, new ToolStopped()); continue; }
      // A withdrawn network answer cannot wait for the frame's next start: its CSP still lets pictures out.
      if (framesOf(entry).some((frame) => frame.network) && !this.networkOn(entry)) { this.end(entry, new ToolStopped()); continue; }
      this.settingsChanged(entry, tool);
      const keys = new Set<string>();
      for (const change of changes) {
        if (change.kind !== 'tooldata' || change.parent !== entry.module) continue;
        const value = this.session.store.get('tooldata', change.id)?.value;
        const previous = entry.data.get(change.id);
        const current = value && { key: value.key, json: JSON.stringify(value.value) };
        if (current?.json === previous?.json && current?.key === previous?.key) continue;
        if (previous) keys.add(previous.key);
        if (current) { keys.add(current.key); entry.data.set(change.id, current); }
        else entry.data.delete(change.id);
      }
      if (keys.size) {
        for (const frame of framesOf(entry)) this.send(frame, { kind: 'storage', keys: [...keys] });
        this.idle(entry);
      }
      for (const frame of framesOf(entry)) {
        for (const [id, pending] of frame.pending) if (!this.allowed(pending.chat, entry.module)) this.settle(frame, id, new ToolStopped());
        if (frame.page?.chat && !this.allowed(frame.page.chat, entry.module)) this.endFrame(frame, new ToolStopped(), true);
      }
      if (entry.chat !== null && !this.allowed(entry.chat, entry.module)) { entry.chat = null; this.publish(); }
      if (entry.chats.size && !entry.pages.size && !entry.slot && ![...entry.chats].some((chat) => this.allowed(chat, entry.module))) this.end(entry, new ToolStopped());
    }
  }
}

export const createTools = (session: Pick<Session, 'store' | 'files'>, scripts: () => Scripts): Tools & Binding<ToolUnit, ToolEvent, ToolReach> => new ToolHost(session, scripts);
