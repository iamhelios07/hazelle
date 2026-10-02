import type { Trigger } from '../../engine/import/types';
import type { DisplayItem, Displayed, Event, Lua, Outcome, Script } from '../../engine/lua/run';
import type { Host, Snapshot } from '../../engine/lua/state';
import workerUrl from './worker?worker&url';

// What the runtime asks of the bot scripts' machines: the engine itself in tests, a worker in the browser.
export type Runner = Pick<Lua, 'run' | 'display' | 'close'>;

export type Down =
  | { kind: 'run'; id: number; owner: string; triggers: Trigger[]; snapshot: Snapshot; event: Event }
  | { kind: 'display'; id: number; owner: string; scripts: Script[]; snapshot: Snapshot; items: DisplayItem[] }
  | { kind: 'answer'; call: number; value: unknown }
  | { kind: 'ping' };
export type Up =
  | { kind: 'done'; id: number; result: Outcome | Displayed }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'say'; id: number; args: Parameters<Host['say']> }
  | { kind: 'ask'; id: number; call: number; args: Parameters<Host['ask']> }
  | { kind: 'model'; id: number; call: number; args: Parameters<Host['model']> }
  | { kind: 'tokens'; id: number; call: number; args: Parameters<Host['tokens']> }
  | { kind: 'lore'; id: number; call: number; args: Parameters<Host['lore']> }
  | { kind: 'pong' };

const BEAT_MS = 1000;
// The engine stops a script's stretch at 5 s by itself; this catches what it cannot count, such as one pattern match
// that never ends.
const STUCK_MS = 8000;

export class LuaStuck extends Error {}

type Policy = { createScriptURL(url: string): string };
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('lua-worker', {
  createScriptURL: (url) => {
    if (url !== workerUrl) throw new TypeError('not the Lua worker');
    return url;
  },
});

type Pending = { resolve: (result: Outcome | Displayed) => void; reject: (error: Error) => void; host: Host | null };

// The bot scripts run in a worker, which is ended and started again when a script holds it without answering.
export class LuaWorker implements Runner {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private ids = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private pinged: number | null = null;

  run(owner: string, triggers: Trigger[], snapshot: Snapshot, event: Event, host: Host): Promise<Outcome> {
    return this.send((id) => ({ kind: 'run', id, owner, triggers, snapshot, event }), host) as Promise<Outcome>;
  }

  display(owner: string, scripts: Script[], snapshot: Snapshot, items: DisplayItem[]): Promise<Displayed> {
    return this.send((id) => ({ kind: 'display', id, owner, scripts, snapshot, items }), null) as Promise<Displayed>;
  }

  close() {
    this.end(new LuaStuck('closed'));
  }

  private send(message: (id: number) => Down, host: Host | null): Promise<Outcome | Displayed> {
    const id = ++this.ids;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, host });
      this.open().postMessage(message(id));
      this.beat ??= setInterval(() => this.check(), BEAT_MS);
    });
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker((policy?.createScriptURL(workerUrl) ?? workerUrl) as string, { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<Up>) => this.receive(data);
    worker.onerror = () => this.end(new LuaStuck('crashed'));
    this.worker = worker;
    return worker;
  }

  private receive(message: Up) {
    if (message.kind === 'pong') return void (this.pinged = null);
    const run = this.pending.get(message.id);
    if (!run) return;
    if (message.kind === 'done' || message.kind === 'failed') {
      this.pending.delete(message.id);
      if (this.pending.size === 0) this.rest();
      if (message.kind === 'done') run.resolve(message.result);
      else run.reject(new Error(message.message));
      return;
    }
    if (!run.host) return;
    if (message.kind === 'say') return run.host.say(...message.args);
    const answering: Promise<unknown> = message.kind === 'ask' ? run.host.ask(...message.args) : message.kind === 'model' ? run.host.model(...message.args) : message.kind === 'lore' ? run.host.lore(...message.args) : run.host.tokens(...message.args);
    const worker = this.worker;
    const answer = (value: unknown) => worker?.postMessage({ kind: 'answer', call: message.call, value } satisfies Down);
    // A call the host failed at answers nothing, as a dismissed question does: unanswered, its run would never end.
    void answering.then(answer, () => answer(null));
  }

  // A ping still unanswered after STUCK_MS means a script holds the worker. Counted from the ping, never from the
  // clock alone: a hidden tab's timers run late, and the worker answers at once all the same.
  private check() {
    if (this.pinged !== null) {
      if (Date.now() - this.pinged > STUCK_MS) this.end(new LuaStuck('stuck'));
      return;
    }
    this.pinged = Date.now();
    this.worker?.postMessage({ kind: 'ping' } satisfies Down);
  }

  private rest() {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    this.pinged = null;
  }

  private end(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.rest();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const run of pending) run.reject(error);
  }
}
