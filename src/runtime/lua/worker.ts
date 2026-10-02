import wasm from 'wasmoon/dist/glue.wasm?url';
import { Lua, type Displayed, type Outcome } from '../../engine/lua/run';
import type { Host } from '../../engine/lua/state';
import type { Down, Up } from './client';

const scope = self as unknown as { postMessage(message: Up): void };
let lua: Promise<Lua> | null = null;
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
  lua ??= Lua.create({ wasm });
  const { id } = data;
  lua
    .then<Outcome | Displayed>((machine) => (data.kind === 'run' ? machine.run(data.owner, data.triggers, data.snapshot, data.event, host(id)) : machine.display(data.owner, data.scripts, data.snapshot, data.items)))
    .then(
      (result) => scope.postMessage({ kind: 'done', id, result }),
      (error: unknown) => scope.postMessage({ kind: 'failed', id, message: String(error) }),
    );
});
