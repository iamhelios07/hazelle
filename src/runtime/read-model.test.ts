import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import * as chatModel from '../model/chat';
import type { Chat } from '../model/chat';
import { randomBytes } from '../vault/aead';
import type { api, ApiResult } from './api';
import { ReadModels } from './read-model';
import { ObjectStore, type StoreChange } from './store';
import type { Turn } from './talk';
import * as turnDisplay from './turn';

type Wire = StoreChange & { rev: number; body: string | null };
async function account() {
  const changes: Wire[] = [];
  const request: typeof api = async <T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    if (method === 'GET') {
      const since = Number(path.split('=')[1]);
      const page = changes.filter((change) => change.rev > since).slice(0, 2);
      const cursor = page.at(-1)?.rev ?? since;
      return { ok: true, data: { changes: page, cursor, more: cursor < changes.length, limits: { items: 100, bytes: 1_000_000, body: 100_000 } } as T };
    }
    const writes = (body as { writes: (Omit<Wire, 'rev'> & { baseRev: number | null })[] }).writes;
    if (writes.some((write) => (changes.findLast((change) => change.id === write.id)?.rev ?? null) !== write.baseRev)) return { ok: false, error: 'conflict' };
    const revs = writes.map(({ id, kind, parent, body }) => {
      const rev = changes.length + 1;
      changes.push({ id, kind, parent, body, rev });
      return rev;
    });
    return { ok: true, data: { revs } as T };
  };
  const key = randomBytes(32);
  const open = async () => {
    const store = await ObjectStore.open('account', key, request);
    await store.pull();
    return store;
  };
  return { store: await open(), open };
}

const chat: Chat = { title: null, character: null, models: {} };
const message = (text: string) => ({ type: 'message' as const, role: 'user' as const, text, at: 0, receipt: null });
const card = (name: string): Card => ({ name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: '', utility: false, bias: [], regex: [], triggers: [], lowLevelAccess: false, loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } });
const liveTalk = () => {
  let turn: Turn | null = null;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => turn,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next: Turn | null) => { turn = next; for (const listener of listeners) listener(); },
  };
};

afterEach(() => vi.restoreAllMocks());

describe('per-chat read models', () => {
  it('A: a translation or new entry in A never folds or displays B, including pulled writes', async () => {
    const { store, open } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('A'), { id: 'a1', parent: 'a' });
    await store.create('entry', message('B'), { id: 'b1', parent: 'b' });
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folders = read.library.snapshot();
    const connectionSnapshot = read.kind('connection').snapshot();
    const personaSnapshot = read.kind('persona').snapshot();
    const bChanged = vi.fn();
    read.chat('b').subscribe(bChanged);
    const folded = vi.spyOn(chatModel, 'fold');
    const displayed = vi.spyOn(turnDisplay, 'displayChat');
    await store.create('entry', { type: 'translation', version: 'a1', text: '번역', receipt: null, at: 1 }, { parent: 'a' });
    const phone = await open();
    await phone.create('entry', message('later'), { parent: 'a' });
    await store.pull();
    expect(folded).toHaveBeenCalledTimes(2);
    expect(folded.mock.calls.every(([entries]) => entries.every((entry) => entry.parent === 'a'))).toBe(true);
    expect(displayed.mock.calls.map(([, id]) => id)).toEqual(['a', 'a']);
    expect(read.chat('b').snapshot()).toBe(b);
    expect(bChanged).not.toHaveBeenCalled();
    expect(read.library.snapshot()).not.toBe(folders);
    expect(read.kind('connection').snapshot()).toBe(connectionSnapshot);
    expect(read.kind('persona').snapshot()).toBe(personaSnapshot);
    expect(read.chat('a').snapshot()?.title).toBe('번역');
    expect(read.chat('a').snapshot()?.preview).toBe('later');
    read.close();
  });

  it('B: character, prompt and persona changes redisplay only their readers and replace recorded dependencies', async () => {
    const { store } = await account();
    for (const id of ['ca', 'cb']) await store.create('character', { card: card(id), folder: null, loreFolders: [] }, { id });
    for (const id of ['pa', 'pb']) await store.create('prompt', { name: id, blocks: [], toggles: [], authorNote: '', models: {} }, { id });
    for (const id of ['ua', 'ub']) await store.create('persona', { name: id, description: '', picture: null }, { id });
    await store.create('chat', { ...chat, character: 'ca', prompt: 'pa', persona: 'ua' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'cb', prompt: 'pb', persona: 'ub' }, { id: 'b' });
    for (const id of ['a', 'b']) await store.create('entry', message('{{char}} / {{user}} / {{authornote}}'), { parent: id });
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folded = vi.spyOn(chatModel, 'fold');
    const displayed = vi.spyOn(turnDisplay, 'displayChat');
    await store.update('character', 'ca', (current) => ({ ...current, card: { ...current.card, name: 'Luna' } }));
    await store.update('prompt', 'pa', (current) => ({ ...current, authorNote: 'night' }));
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'Mina' }));
    expect(displayed.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'a']);
    expect(folded).not.toHaveBeenCalled();
    expect(read.chat('b').snapshot()).toBe(b);
    expect(read.chat('a').snapshot()?.display.texts).toEqual(['Luna / Mina / night']);
    await store.update('chat', 'a', (current) => ({ ...current, persona: 'missing' }));
    displayed.mockClear();
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'unused' }));
    expect(displayed).not.toHaveBeenCalled();
    await store.create('persona', { name: 'arrived', description: '', picture: null }, { id: 'missing' });
    expect(displayed.mock.calls.map(([, id]) => id)).toEqual(['a']);
    expect(read.chat('a').snapshot()?.preview).toBe('Luna / arrived / night');
    read.close();
  });

  it('keeps transient sent messages stable across chunks and resizes only the open chat', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('latest: {{lastmessage}}'), { parent: 'a' });
    const read = new ReadModels(store);
    const talk = liveTalk();
    const opening = { chat, messages: [] };
    const screen = read.screen('a', talk, opening);
    const leave = screen.subscribe(() => {});
    screen.setInputs(opening, { width: 800, height: 600 });
    const displayed = vi.spyOn(turnDisplay, 'displayChat');
    const first = screen.snapshot();
    // A composer or panel render has new wrapper objects, not new display inputs.
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(first);
    expect(screen.snapshot()).toBe(first);
    expect(displayed).not.toHaveBeenCalled();
    const turn: Turn = { chat: 'a', said: { id: 'said', text: 'question' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'one' };
    talk.set(turn);
    const chunk = screen.snapshot();
    talk.set({ ...turn, text: 'one two' });
    const next = screen.snapshot();
    expect(displayed.mock.calls.map(([, id]) => id)).toEqual(['a', 'a']);
    expect(next.display.texts[0]).toBe('latest: one two');
    expect(next.messages[0]).toBe(chunk.messages[0]);
    expect(next.messages[1]).toBe(chunk.messages[1]);
    expect(next.messages[2]).not.toBe(chunk.messages[2]);
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(next);
    expect(displayed).toHaveBeenCalledTimes(2);
    const b = read.chat('b').snapshot();
    screen.setInputs(opening, { width: 900, height: 600 });
    expect(displayed.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'a']);
    expect(read.chat('b').snapshot()).toBe(b);
    leave();
    read.close();
  });

  it('emits kind/id/parent for batch, remove, restore and paginated pull, and ignores stale echoes', async () => {
    const { store, open } = await account();
    const observed: StoreChange[][] = [];
    store.subscribe((changes) => observed.push([...changes]));
    await store.batch([
      { type: 'create', kind: 'chat', id: 'c', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'e', parent: 'c', value: message('hi') },
    ]);
    expect(observed).toEqual([[{ kind: 'entry', id: 'e', parent: 'c' }, { kind: 'chat', id: 'c', parent: null }]]);
    const entry = store.get('entry', 'e')!;
    await store.pull();
    expect(observed).toHaveLength(1);
    await store.remove('e');
    await store.restore(entry);
    expect(observed.slice(1)).toEqual([[{ kind: 'entry', id: 'e', parent: 'c' }], [{ kind: 'entry', id: 'e', parent: 'c' }]]);
    const phone = await open();
    for (let index = 0; index < 3; index++) await phone.create('entry', message('remote'), { id: `r${index}`, parent: 'c' });
    observed.length = 0;
    await store.pull();
    expect(observed).toHaveLength(2);
    expect(observed.flat()).toEqual([0, 1, 2].map((index) => ({ kind: 'entry', id: `r${index}`, parent: 'c' })));
  });

  it('serves unsaved greetings and a first live turn while the same id becomes stored', async () => {
    const { store } = await account();
    const read = new ReadModels(store);
    const talk = liveTalk();
    const greeting: chatModel.Message = { id: 'opening', role: 'assistant', at: 0, versions: [{ id: 'g', seed: 'g', text: '{{screenwidth}}', receipt: null, edited: false, at: 0 }], selected: 0 };
    const opening = { chat, messages: [greeting] };
    const screen = read.screen('new', talk, opening);
    const leave = screen.subscribe(() => {});
    screen.setInputs(opening, { width: 800, height: 600 });
    expect(screen.snapshot().display.texts).toEqual(['800']);
    expect(read.displayed('new')?.display.texts).toEqual(['{{screenwidth}}']);
    const displayed = vi.spyOn(turnDisplay, 'displayChat');
    read.displayed('new');
    expect(displayed).not.toHaveBeenCalled();
    talk.set({ chat: 'new', said: { id: 'said', text: 'hi' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'hello' });
    expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['opening', 'said', 'reply']);
    await store.batch([
      { type: 'create', kind: 'entry', id: 'g', parent: 'new', value: { ...message('{{screenwidth}}'), role: 'assistant' } },
      { type: 'create', kind: 'chat', id: 'new', parent: null, value: chat },
    ]);
    expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['g', 'said', 'reply']);
    expect(screen.snapshot().display.texts).toEqual(['800', 'hi', 'hello']);
    expect(read.displayed('new')?.display.texts).toEqual(['{{screenwidth}}']);
    leave();
    read.close();
  });

  it('keeps populated chat order on rename and unchanged summaries on dependency writes', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('a first'), { id: 'a1', parent: 'a' });
    const read = new ReadModels(store);
    await store.update('chat', 'b', (current) => ({ ...current, title: 'renamed' }));
    expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']);
    // Empty chats use their own rev; once entries exist, only entries determine their recency.
    await store.create('entry', message('b first'), { id: 'b1', parent: 'b' });
    const messages = read.messages.snapshot();
    await store.update('chat', 'a', (current) => ({ ...current, title: 'A' }));
    expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']);
    expect(read.messages.snapshot()).toBe(messages);
    const summaries = read.chats.snapshot();
    const library = read.library.snapshot();
    await store.upsert('settings', () => ({ models: {} }));
    expect(read.chats.snapshot()).toBe(summaries);
    expect(read.library.snapshot()).toBe(library);
    expect(read.messages.snapshot()).toBe(messages);
    read.close();
  });
});
