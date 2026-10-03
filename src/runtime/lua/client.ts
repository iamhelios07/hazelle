import type { Trigger } from '../../engine/import/types';
import type { DisplayBatch, DisplayItem, Event, Lua, Outcome, Script } from '../../engine/lua/run';
import type { Host, LuaMessage, Snapshot } from '../../engine/lua/state';
import { changedTail, sameHistory, type Tail } from '../history-delta';
import { Heartbeat, moduleWorker } from '../worker';
import workerUrl from './worker?worker&url';

export type Runner = Pick<Lua, 'run' | 'installDisplay' | 'display' | 'forgetDisplay' | 'close'>;

export type DisplayInstall = { revision: number; scripts: Script[]; snapshot: Omit<Snapshot, 'messages' | 'scope'> & { scope: Omit<Snapshot['scope'], 'messages'> }; messages: Tail<LuaMessage>; history: Tail<Snapshot['scope']['messages'][number]>; items: DisplayItem[] };

export type Down =
  | { kind: 'run'; id: number; owner: string; triggers: Trigger[]; snapshot: Snapshot; event: Event }
  | { kind: 'install-display'; id: number; owner: string; install: DisplayInstall }
  | { kind: 'display'; id: number; owner: string; revision: number; size: number }
  | { kind: 'forget-display'; owner: string; revision: number }
  | { kind: 'answer'; call: number; value: unknown }
  | { kind: 'ping' };
export type Up =
  | { kind: 'done'; id: number; result: Outcome | DisplayBatch | null }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'say'; id: number; args: Parameters<Host['say']> }
  | { kind: 'ask'; id: number; call: number; args: Parameters<Host['ask']> }
  | { kind: 'model'; id: number; call: number; args: Parameters<Host['model']> }
  | { kind: 'tokens'; id: number; call: number; args: Parameters<Host['tokens']> }
  | { kind: 'lore'; id: number; call: number; args: Parameters<Host['lore']> }
  | { kind: 'pong' };

// The engine stops a script's stretch at 5 s by itself; this catches what it cannot count, such as one pattern match
// that never ends.
const STUCK_MS = 8000;

export class LuaStuck extends Error {}

type Pending = { resolve: (result: Outcome | DisplayBatch | null) => void; reject: (error: Error) => void; host: Host | null };

export class LuaWorker implements Runner {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private readonly displays = new Map<string, { revision: number; snapshot: Snapshot }>();
  private ids = 0;
  private readonly heart = new Heartbeat(STUCK_MS, () => this.worker?.postMessage({ kind: 'ping' } satisfies Down), () => this.end(new LuaStuck('stuck')));

  run(owner: string, triggers: Trigger[], snapshot: Snapshot, event: Event, host: Host): Promise<Outcome> {
    return this.send((id) => ({ kind: 'run', id, owner, triggers, snapshot, event }), host) as Promise<Outcome>;
  }

  installDisplay(owner: string, revision: number, scripts: Script[], snapshot: Snapshot, items: DisplayItem[]): Promise<void> {
    const previous = this.displays.get(owner)?.snapshot;
    const { messages, scope, ...rest } = snapshot;
    const { messages: history, ...fixed } = scope;
    const install: DisplayInstall = {
      revision, scripts, items, snapshot: { ...rest, scope: fixed },
      messages: changedTail(previous?.messages ?? [], messages, (a, b) => a.role === b.role && a.data === b.data && a.time === b.time),
      history: changedTail(previous?.scope.messages ?? [], history, sameHistory),
    };
    this.displays.set(owner, { revision, snapshot });
    return this.send((id) => ({ kind: 'install-display', id, owner, install }), null).then(() => {});
  }

  display(owner: string, revision: number, size: number): Promise<DisplayBatch> {
    return this.send((id) => ({ kind: 'display', id, owner, revision, size }), null) as Promise<DisplayBatch>;
  }

  forgetDisplay(owner: string, revision: number) {
    if (this.displays.get(owner)?.revision === revision) this.displays.delete(owner);
    this.worker?.postMessage({ kind: 'forget-display', owner, revision } satisfies Down);
  }

  close() {
    this.end(new LuaStuck('closed'));
  }

  private send(message: (id: number) => Down, host: Host | null): Promise<Outcome | DisplayBatch | null> {
    const id = ++this.ids;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, host });
      this.open().postMessage(message(id));
      this.heart.start();
    });
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<Up>) => this.receive(data);
    worker.onerror = () => this.end(new LuaStuck('crashed'));
    this.worker = worker;
    return worker;
  }

  private receive(message: Up) {
    if (message.kind === 'pong') return this.heart.answered();
    const run = this.pending.get(message.id);
    if (!run) return;
    if (message.kind === 'done' || message.kind === 'failed') {
      this.pending.delete(message.id);
      if (this.pending.size === 0) this.heart.rest();
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

  private end(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.displays.clear();
    this.heart.rest();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const run of pending) run.reject(error);
  }
}
