import { gunzipSync, gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importPreset } from '../engine/import/preset';
import { unpack } from '../engine/import/risum';
import type { Block } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { fromBase64 } from '../vault/aead';
import { chatModel, setPromptModel } from './assignment';
import { setChatPrompt } from './chat-log';
import { addPrompt, addStarter, chatPrompt, copyPrompt, importPrompt, removePrompt, restorePrompt, setDefaultPrompt } from './prompts';
import starter from './starter-prompt.risup?inline';
import { testServer } from './testing';

const server = testServer();

const bytes = fromBase64(starter.slice(starter.indexOf(',') + 1));

// A block as the prompt editor lists it: its kind, name, role and mark, or its wrapper's first line, or its range.
function outline(block: Block) {
  if (block.kind === 'text') return ['text', block.name, block.role, block.mark];
  if (block.slot === 'chat') return [block.slot, block.name, block.range];
  if ('role' in block) return [block.slot, block.name, block.role, block.wrapper?.split('\n')[0] ?? null];
  return [block.slot, block.name];
}

describe('importPreset', () => {
  it('reads the starter preset into its 13 blocks and its toggle, and counts what it does not take', async () => {
    const read = await importPreset(bytes);
    if (!read.ok) throw new Error(read.failure.kind);
    const { prompt, unsupported } = read;
    expect(prompt.name).toBe('🏓 핑퐁 간소화');
    expect(prompt.blocks.map(outline)).toEqual([
      ['text', null, 'system', null],
      ['description', null, 'assistant', '<Role-play Materials>'],
      ['persona', null, 'system', '[<user> (Main PC)]'],
      ['text', null, 'system', null],
      ['lorebook', null],
      ['text', null, 'system', null],
      ['text', null, 'system', null],
      ['text', '글노덮', 'system', 'globalNote'],
      ['authorNote', null, 'assistant', null],
      ['postEverything', null],
      ['text', '가이드라인 (중요!!!)', 'system', 'main'],
      ['chat', '과거 챗', { from: 0, to: -1 }],
      ['chat', '마지막 챗', { from: -1, to: null }],
    ]);
    expect(prompt.toggles).toEqual([{ key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' }]);
    expect([prompt.authorNote, prompt.models, prompt.imported]).toEqual(['', {}, 'risu-preset']);
    expect(unsupported).toEqual([
      { kind: 'memory', count: 1 },
      { kind: 'preset-text', count: 3 },
      { kind: 'settings', count: 1 },
    ]);
  });

  it('fails as decrypt-failed when the sealed preset was altered, and as unreadable when the file is cut', async () => {
    const pack = new Uint8Array(256);
    unpack(Uint8Array.from({ length: 256 }, (_, byte) => byte)).forEach((plain, packed) => (pack[plain] = packed));
    const inflated = gunzipSync(unpack(bytes));
    inflated[inflated.length - 1]! ^= 1;
    expect(await importPreset(gzipSync(inflated).map((byte) => pack[byte]!))).toEqual({ ok: false, failure: { kind: 'decrypt-failed' } });
    expect(await importPreset(bytes.subarray(0, 100))).toEqual({ ok: false, failure: { kind: 'unreadable' } });
  });
});

describe('addStarter', () => {
  it('adds the starter prompt as the default once, even from two devices at the same time', async () => {
    const { store, open } = await server.account();
    const other = await open();
    await Promise.all([addStarter(store), addStarter(other)]);
    await store.pull();
    const [prompt, ...more] = store.list('prompt');
    expect([prompt?.value.name, more.length]).toEqual(['🏓 핑퐁 간소화', 0]);
    expect(store.get('settings', SETTINGS_ID)?.value.prompt).toBe(prompt!.id);

    const mine = await addPrompt(store, '내 프롬프트');
    await setDefaultPrompt(store, mine.ok ? mine.data.id : '');
    await removePrompt(store, prompt!.id);
    await addStarter(store);
    expect(store.list('prompt').map((kept) => kept.value.name)).toEqual(['내 프롬프트']);
  });
});

describe('prompts', () => {
  it('copies a prompt as the user’s own, remembering its origin', async () => {
    const { store } = await server.account();
    const imported = await importPrompt(store, bytes);
    const id = imported.ok ? imported.id : '';
    const copied = await copyPrompt(store, id, '핑퐁 (사본)');
    const original = store.get('prompt', id)!.value;
    expect(copied.ok && copied.data.value).toEqual({ ...original, name: '핑퐁 (사본)', origin: { id, name: '🏓 핑퐁 간소화' }, imported: undefined });
    expect(copied.ok && 'imported' in copied.data.value).toBe(false);
  });

  it('refuses to delete the default prompt, and brings back another deleted one', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPrompt(store, '하나'), addPrompt(store, '둘')]);
    const [one, two] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    await setDefaultPrompt(store, one!);
    expect(await removePrompt(store, one!)).toEqual({ ok: false, error: 'default' });
    const removed = await removePrompt(store, two!);
    expect(store.get('prompt', two!)).toBeNull();
    if (removed.ok) await restorePrompt(store, removed.data);
    expect(store.get('prompt', two!)?.value.name).toBe('둘');
  });

  it('gives a chat its prompt’s model under its own layer, and reads a deleted prompt of its own as missing', async () => {
    const { store } = await server.account();
    const model = { id: 'm', name: 'M', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null };
    const connection = await store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [model] });
    const [byDefault, own] = await Promise.all([addPrompt(store, '기본'), addPrompt(store, '따로')]);
    const [defaultId, ownId] = [byDefault, own].map((added) => (added.ok ? added.data.id : ''));
    await setDefaultPrompt(store, defaultId!);
    await setPromptModel(store, defaultId!, 'main', { connection: connection.ok ? connection.data.id : '', model: 'm' });
    const created = await store.create('chat', { title: null, character: null, models: {} });
    const chat = created.ok ? created.data.id : '';
    const read = () => store.get('chat', chat)!.value;

    expect(chatModel(store, read())).toMatchObject({ model: { id: 'm' } });
    await setChatPrompt(store, chat, ownId!);
    await removePrompt(store, ownId!);
    expect(chatPrompt(store, read())).toEqual({ kind: 'missing', own: true });
    await setChatPrompt(store, chat, null);
    expect(chatPrompt(store, read())).toMatchObject({ kind: 'prompt', own: false, prompt: { id: defaultId } });
  });
});
