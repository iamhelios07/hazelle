import { isRecord } from '../../connectors/values';
import { TOOL_FILE_BYTES } from '../../engine/import/tool';
import { Runaway } from '../../engine/cbs/evaluate';
import type { Event, Host, ModelMessage, Question } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import { live } from '../../model/library';
import { toolId, toolVar, type Tool, type ToolUnit } from '../../model/tool';
import type { Json } from '../../tool-api/manifest';
import type { ChatHeader, Down, EventName, Message, ToolOutcome } from '../../tool-api/protocol';
import type { ToolState } from '../evaluation-core';
import { changedTail } from '../history-delta';
import type { ScriptOutcome } from '../lua/event';
import type { Scripts } from '../scripts';
import { noOutcome, ToolLate, ToolStopped, ToolStuck, type Binding } from '../script-binding';
import type { Session } from '../session';
import type { StoreChange } from '../store';
import { Heartbeat } from '../worker';
import type { ToolMenu, ToolPage, Tools } from './facade';
import { toolFrame, type Connection, type OpenFrame } from './frame';
import { decodeState, encodeState } from './state';
import { toolData, toolKeys, toolsOf, ToolWrites } from './store';

type Context = { chat: string; scope: ChatScope; host: Host; signal: AbortSignal; state?: Promise<ToolState> };
type Pending = Context & { cancel: AbortController; resolve(outcome: ScriptOutcome): void; reject(error: Error): void; stop(): void };
type Frame = {
  id: number; entry: Entry; connection: Connection; page?: ToolPage; closing: AbortController; heart: Heartbeat;
  loaded: boolean; ready: Promise<void>; resolve(): void; reject(error: Error): void; loadTimer: ReturnType<typeof setTimeout> | null;
  listens: Set<EventName>; pending: Map<number, Pending>; calls: Set<number>; messages: Message[];
  reading: Promise<unknown>; lanes: Set<string>; release(): void;
};
type Entry = { module: string; tool: Tool; settings: string; background: Frame | null; pages: Set<Frame>; chats: Set<string>; idle: ReturnType<typeof setTimeout> | null; data: Map<string, { key: string; json: string }> };
const EVENTS = new Set<EventName>(['reply', 'prompt', 'menu', 'settings', 'message']);
const IDLE_MS = 10 * 60_000;
const STUCK_MS = 8000;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
const aborted = (signal: AbortSignal): Error => signal.reason instanceof ToolLate || signal.reason instanceof ToolStuck ? signal.reason : new ToolStopped();
const framesOf = (entry: Entry) => [...(entry.background ? [entry.background] : []), ...entry.pages];

function until<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted(signal));
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => { stop = () => reject(aborted(signal)); signal.addEventListener('abort', stop, { once: true }); });
  return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', stop));
}

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
  return value.kind === 'select' && Array.isArray(value.options) && value.options.every((option) => typeof option === 'string');
}
function isModelMessages(value: unknown): value is ModelMessage[] {
  return Array.isArray(value) && value.every((message) => isRecord(message) && (message.role === 'system' || message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
}
function isOutcome(value: unknown): value is ToolOutcome {
  return isRecord(value) && (value.value === undefined || value.value === null || typeof value.value === 'string')
    && Array.isArray(value.writes) && value.writes.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && (pair[1] === undefined || isJson(pair[1])))
    && Array.isArray(value.edits) && value.edits.every((edit) => isRecord(edit) && Number.isInteger(edit.index) && typeof edit.text === 'string')
    && Array.isArray(value.added) && value.added.every((item) => isRecord(item) && (item.role === 'user' || item.role === 'char') && typeof item.text === 'string');
}
const header = (chat: string, scope: ChatScope): ChatHeader => ({ id: chat, character: scope.card && { name: scope.card.name, description: scope.card.description }, persona: scope.persona, length: scope.messages.length - (scope.greeting === null ? 0 : 1) });

export class ToolHost implements Tools, Binding<ToolUnit> {
  private readonly entries = new Map<string, Entry>();
  private readonly code = new Map<string, Promise<string>>();
  private readonly stalls = new Map<string, number>();
  private readonly writes: ToolWrites;
  private readonly closing = new AbortController();
  private readonly unsubscribe: () => void;
  private ids = 0;

  constructor(private readonly session: Pick<Session, 'store' | 'files'>, private readonly scripts: () => Pick<Scripts, 'report' | 'pageContext' | 'pageWrite'>, private readonly open: OpenFrame = toolFrame) {
    this.writes = new ToolWrites(session.store);
    this.unsubscribe = session.store.subscribe((changes) => this.changed(changes));
  }

  menus(chat: string): ToolMenu[] {
    const stored = live(this.session.store.get('chat', chat));
    return stored ? toolsOf(this.session.store, stored.value).map(({ module, tool }) => ({ module, manifest: tool.manifest })) : [];
  }

  async warm(chat: string): Promise<void> {
    await Promise.all(this.menus(chat).map(async ({ module }) => {
      try { const entry = this.entry(module); entry.chats.add(chat); await this.background(entry); }
      catch (error) { this.scripts().report(chat, error, { kind: 'module', id: module }); }
    }));
  }

  async run(chat: string, [unit]: ToolUnit[], scope: ChatScope, event: Event, host: Host, signal?: AbortSignal): Promise<ScriptOutcome> {
    if (!unit || (event.kind !== 'reply' && event.kind !== 'prompt' && event.kind !== 'menu')) return noOutcome();
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
      frame.pending.set(id, { chat, scope, host, signal: stop, cancel, resolve, reject, stop: () => stop.removeEventListener('abort', abort) });
      this.idle(entry);
      this.send(frame, { kind: 'event', id, event: event.kind, chat: header(chat, scope), ...(event.kind === 'reply' && { reply: { id: event.id, index: event.index } }), ...(event.kind === 'menu' && { item: event.item }) });
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

  settingsChanged(module: string) {
    const entry = this.entries.get(module);
    const tool = this.session.store.get('tool', toolId(module))?.value;
    if (!entry || !tool) return;
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
    this.writes.close();
    this.code.clear();
  }

  private allowed(chat: string, module: string): boolean {
    const stored = live(this.session.store.get('chat', chat));
    return !!stored && toolsOf(this.session.store, stored.value).some((unit) => unit.module === module);
  }

  private entry(module: string): Entry {
    if (this.closing.signal.aborted) throw new ToolStopped();
    if ((this.stalls.get(module) ?? 0) >= 3) throw new ToolStuck('Reload to restart this tool', true);
    const { store } = this.session;
    const tool = store.get('tool', toolId(module))?.value;
    if (!tool || !live(store.get('module', module))) throw new ToolStopped();
    const current = this.entries.get(module);
    if (current) return current;
    const entry: Entry = { module, tool, settings: JSON.stringify(tool.settings), background: null, pages: new Set(), chats: new Set(), idle: null, data: new Map(store.children('tooldata', module).map(({ id, value }) => [id, { key: value.key, json: JSON.stringify(value.value) }])) };
    this.entries.set(module, entry);
    return entry;
  }

  private async background(entry: Entry): Promise<Frame> {
    const frame = entry.background ??= this.frame(entry);
    await frame.ready;
    return frame;
  }

  private frame(entry: Entry, page?: ToolPage): Frame {
    const connection = this.open(page);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
    const lease = page?.chat ? this.session.store.retainChat(page.chat) : null;
    const frame: Frame = {
      id: ++this.ids, entry, connection, page, closing: new AbortController(),
      heart: new Heartbeat(() => this.send(frame, { kind: 'ping' }), () => this.stalled(frame)),
      loaded: false, ready, resolve, reject, loadTimer: null,
      listens: new Set(), pending: new Map(), calls: new Set(), messages: [], reading: Promise.resolve(), lanes: new Set(), release: () => lease?.release(),
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
      this.send(frame, { kind: 'load', api: 1, role: page ? 'page' : 'background', code, manifest: entry.tool.manifest, settings: entry.tool.settings, chat: context ? header(page!.chat!, context.scope) : null, theme: page?.theme ?? 'dark' });
    }).catch((error: unknown) => this.endFrame(frame, error instanceof Error ? error : new Error(String(error)), true));
    return frame;
  }

  private source(tool: Tool): Promise<string> {
    const held = this.code.get(tool.file.id);
    if (held) return held;
    const reading = this.session.files.read(tool.file, { signal: this.closing.signal }).then((read) => {
      if (!read.ok) throw new Error(`Tool file: ${read.error}`);
      if (read.data.byteLength > TOOL_FILE_BYTES) throw new Error('Tool file exceeds 8 MB');
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
      frame.calls.add(call);
      void this.call(frame, data.method, data.args, data.event).then(
        (value) => this.send(frame, { kind: 'answer', call, ok: true, value }),
        (error: unknown) => this.send(frame, { kind: 'answer', call, ok: false, value: describe(error) }),
      ).finally(() => frame.calls.delete(call));
      return;
    }
    if (data.kind === 'done' || data.kind === 'failed') {
      const id = Number(data.id);
      if (!Number.isSafeInteger(data.id)) return;
      if (id === 0) {
        if (data.kind === 'failed' && typeof data.message === 'string') this.scripts().report(frame.page?.chat ?? '', new Error(data.message), { kind: 'module', id: frame.entry.module });
        else if (data.kind === 'done' && frame.page?.chat) {
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
    const chat = frame.page?.chat;
    const context = chat && this.scripts().pageContext(chat, frame.entry.module, frame.closing.signal);
    if (!context || !chat) throw new Error('no-chat');
    return { ...context, chat, signal: frame.closing.signal };
  }

  private async call(frame: Frame, method: string, args: unknown[], event: unknown): Promise<unknown> {
    const entry = frame.entry;
    if (!live(this.session.store.get('module', entry.module))) throw new ToolStopped();
    const [first, second] = args;
    switch (method) {
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
          const messages: Message[] = context.scope.messages.slice(greeting).map((message, index) => ({ index, id: message.id, role: message.role === 'user' ? 'user' : 'char', text: state.texts[index + greeting]!, time: message.time ?? 0 }));
          const tail = changedTail(frame.messages, messages, (a, b) => a.id === b.id && a.role === b.role && a.text === b.text && a.time === b.time);
          frame.messages = messages;
          return tail;
        }
        if (method === 'chat.state.get' && typeof first === 'string') return decodeState(new Map((await this.state(frame, context)).variables).get(toolVar(entry.tool.manifest, first)));
        if (method === 'model' && (first === 'main' || first === 'aux') && isModelMessages(second)) {
          if (!entry.tool.manifest.uses.includes('model')) return { ok: false, reason: 'not-declared' };
          const result = await context.host.model(first, second.map(({ role, content }) => ({ role, content })), owner, context.signal);
          return result.success ? { ok: true, text: result.result } : { ok: false, reason: result.reason };
        }
        if (method === 'tokens' && typeof first === 'string') return context.host.tokens(first);
        if (method === 'lore' && (first === null || typeof first === 'number' && Number.isFinite(first) && first >= 0)) return context.host.lore(first);
        if (method === 'ask' && isQuestion(first)) return context.host.ask(first, owner, context.signal);
        if (method === 'say' && (first === 'normal' || first === 'error') && typeof second === 'string') return context.host.say(first, second, owner);
      }
    }
    throw new Error('Invalid tool call');
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
    return { ...noOutcome(), value: value.value, handled: true, writes: [...new Map(value.writes)].map(([key, data]) => [toolVar(frame.entry.tool.manifest, key), encodeState(data)]), edits: edits.map((edit) => ({ ...edit, wrote: state!.wrote[edit.index + greeting]! })), added: value.added };
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
    if (entry.pages.size || framesOf(entry).some((frame) => frame.pending.size)) return;
    entry.idle = setTimeout(() => this.end(entry, new ToolStopped()), IDLE_MS);
  }

  private stalled(frame: Frame) {
    if (frame.closing.signal.aborted) return;
    this.stalls.set(frame.entry.module, (this.stalls.get(frame.entry.module) ?? 0) + 1);
    const error = new ToolStuck('Tool stopped answering', this.stalls.get(frame.entry.module)! >= 3);
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
    if (frame.entry.background === frame) frame.entry.background = null;
    if (closePage) frame.page?.close();
  }

  private end(entry: Entry, error: Error) {
    if (entry.idle) clearTimeout(entry.idle);
    for (const frame of framesOf(entry)) this.endFrame(frame, error, true);
    this.writes.cancel(entry.module);
    if (this.entries.get(entry.module) === entry) this.entries.delete(entry.module);
  }

  private changed(changes: readonly StoreChange[]) {
    for (const entry of [...this.entries.values()]) {
      const tool = this.session.store.get('tool', toolId(entry.module))?.value;
      if (!tool || !live(this.session.store.get('module', entry.module)) || tool.file.id !== entry.tool.file.id || JSON.stringify(tool.manifest) !== JSON.stringify(entry.tool.manifest)) { this.end(entry, new ToolStopped()); continue; }
      this.settingsChanged(entry.module);
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
      if (entry.chats.size && !entry.pages.size && ![...entry.chats].some((chat) => this.allowed(chat, entry.module))) this.end(entry, new ToolStopped());
    }
  }
}

export const createTools = (session: Pick<Session, 'store' | 'files'>, scripts: () => Scripts): Tools & Binding<ToolUnit> => new ToolHost(session, scripts);
