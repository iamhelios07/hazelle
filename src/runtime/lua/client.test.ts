import { afterEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../engine/lua/state';
import { LuaWorker, type Down, type Up } from './client';

const snapshot: Snapshot = {
  messages: [{ role: 'user', data: 'first', time: 0 }, { role: 'char', data: 'last', time: 1 }], variables: [], globals: [],
  character: { name: '', description: '', firstMessage: '' }, persona: { name: '', description: '' }, note: '',
  scope: { card: null, persona: null, prompt: null, note: null, lore: [], variables: [], greeting: null, model: null, clock: { now: 0, timeZone: 'UTC' }, assets: [], modules: [], faces: { char: null, user: null }, screen: null, pick: 'chat', messages: [
    { id: 'a', seed: 'a', role: 'user', text: 'first', time: 0 }, { id: 'b', seed: 'b', role: 'assistant', text: 'last', time: 1 },
  ] },
};

afterEach(() => vi.unstubAllGlobals());

it('installs history deltas once per revision and sends only generation/size for stretches', async () => {
  const sent: Down[] = [];
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: Up }) => void) | null = null;
    postMessage(message: Down) {
      sent.push(structuredClone(message));
      if ('id' in message) queueMicrotask(() => this.onmessage?.({ data: { kind: 'done', id: message.id, result: message.kind === 'install-display' ? null : { texts: [], listening: [], errors: [], missing: [], from: 0, remaining: 0 } } }));
    }
    terminate() {}
  });
  const runner = new LuaWorker();
  try {
    await runner.installDisplay('chat', 1, [], snapshot, []);
    await runner.display('chat', 1, 8);
    await runner.display('chat', 1, 512);
    const next = { ...snapshot, messages: [snapshot.messages[0]!, { ...snapshot.messages[1]!, data: 'new' }], scope: { ...snapshot.scope, messages: [snapshot.scope.messages[0]!, { ...snapshot.scope.messages[1]!, text: 'new' }] } };
    await runner.installDisplay('chat', 2, [], next, []);
    runner.forgetDisplay('chat', 1);
    await runner.installDisplay('chat', 3, [], next, []);
    const installed = sent.filter((message) => message.kind === 'install-display');
    expect(installed.map(({ install }) => [install.messages.from, install.messages.items.length, install.history.from, install.history.items.length])).toEqual([[0, 2, 0, 2], [1, 1, 1, 1], [2, 0, 2, 0]]);
    expect(sent.filter((message) => message.kind === 'display')).toEqual([
      { kind: 'display', id: 2, owner: 'chat', generation: 1, size: 8 },
      { kind: 'display', id: 3, owner: 'chat', generation: 1, size: 512 },
    ]);
  } finally { runner.close(); }
});
