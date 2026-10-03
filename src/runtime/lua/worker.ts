import wasm from 'wasmoon/dist/glue.wasm?url';
import { Lua, type DisplayBatch, type Outcome } from '../../engine/lua/run';
import type { Host, Snapshot } from '../../engine/lua/state';
import { applyTail } from '../history-delta';
import type { Down, Up } from './client';

const scope = self as unknown as { postMessage(message: Up): void };
let lua: Promise<Lua> | null = null;
const displays = new Map<string, { generation: number; snapshot: Snapshot }>();
let calls = 0;
const waiting = new Map<number, (value: never) => void>();

const host = (id: number): Host => {
  const asked = <T>(send: (call: number) => Up) =>
    new Promise<T>((resolve) => {
      const call = ++calls;
      waiting.set(call, resolve);
      scope.postMessage(send(call));
    });
  return {
    say: (...args) => scope.postMessage({ kind: 'say', id, args }),
    ask: (...args) => asked((call) => ({ kind: 'ask', id, call, args })),
    model: (...args) => asked((call) => ({ kind: 'model', id, call, args })),
    tokens: (...args) => asked((call) => ({ kind: 'tokens', id, call, args })),
    lore: (...args) => asked((call) => ({ kind: 'lore', id, call, args })),
  };
};

addEventListener('message', ({ data }: MessageEvent<Down>) => {
  if (data.kind === 'ping') return scope.postMessage({ kind: 'pong' });
  if (data.kind === 'answer') {
    waiting.get(data.call)?.(data.value as never);
    waiting.delete(data.call);
    return;
  }
  if (data.kind === 'forget-display') {
    if (displays.get(data.owner)?.generation === data.generation) displays.delete(data.owner);
    void lua?.then((machine) => machine.forgetDisplay(data.owner, data.generation));
    return;
  }
  lua ??= Lua.create({ wasm });
  const { id } = data;
  lua
    .then<Outcome | DisplayBatch | null>(async (machine) => {
      if (data.kind === 'run') return machine.run(data.owner, data.triggers, data.snapshot, data.event, host(id));
      if (data.kind === 'display') return machine.display(data.owner, data.generation, data.size);
      const previous = displays.get(data.owner)?.snapshot;
      const { install } = data;
      const snapshot: Snapshot = { ...install.snapshot, messages: applyTail(previous?.messages ?? [], install.messages), scope: { ...install.snapshot.scope, messages: applyTail(previous?.scope.messages ?? [], install.history) } };
      displays.set(data.owner, { generation: install.generation, snapshot });
      await machine.installDisplay(data.owner, install.generation, install.scripts, snapshot, install.items);
      return null;
    })
    .then(
      (result) => scope.postMessage({ kind: 'done', id, result }),
      (error: unknown) => scope.postMessage({ kind: 'failed', id, message: String(error) }),
    );
});
