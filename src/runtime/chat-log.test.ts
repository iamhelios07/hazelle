import { describe, expect, it, vi } from 'vitest';
import { calls, fold, shown, type Chat, type ChatItem, type Message, type Receipt } from '../model/chat';
import { memoryId, type MemoryRecord } from '../model/memory';
import { appendCost, appendReply, appendTranslation, appendUserMessage, branchChat, editMessage, removeMessage, startChat } from './chat-log';
import { BATCH_LIMITS, testServer } from './testing';
import { displayChat } from './turn';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included, under the ids it was shown with, so its tags roll the same, and never holds the chat without it', async () => {
    const { store } = await server.account();
    const reader = { store, username: 'jin' };
    const texts = ['하나 {{pick}} {{random}}', '둘', '셋'];
    const opened = async (selected: number) => {
      const id = crypto.randomUUID();
      const chat: Chat = { title: null, character: null, models: {} };
      const versions = texts.map((text) => {
        const id = crypto.randomUUID();
        return { id, seed: id, text, receipt: null, edited: false, at: 0 };
      });
      const before = displayChat(reader, id, chat, [{ id: 'opening', role: 'assistant', at: 0, versions, selected }]);
      let bare = false;
      const leave = store.subscribe(() => {
        bare ||= store.get('chat', id) !== null && store.children('entry', id).length === 0;
      });
      expect(await startChat(store, id, chat, { ids: versions.map((version) => version.id), texts, selected, translations: new Map() })).toBeNull();
      leave();
      expect(bare).toBe(false);
      const messages = fold(store.children('entry', id));
      expect(messages[0]!.versions.map((version) => version.id)).toEqual(versions.map((version) => version.id));
      expect(displayChat(reader, id, chat, messages)).toEqual(before);
      return [shown(messages[0]!).text, messages[0]!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나 {{pick}} {{random}}', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});

describe('branchChat', () => {
  it('copies the messages up to the split as they fold, rolling the same, without the deleted one, and saves the chat after them', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {}, note: '노트' };
    const pending: Receipt = { connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: 'pending', replyId: 'r1', firstTextMs: 100, totalMs: 900, cache: null };
    const said = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    const split = crypto.randomUUID();
    const folded = () => fold(store.children('entry', source));

    await startChat(store, source, chat, { ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], texts: ['하나', '둘 {{random::빨강::파랑::노랑::초록}} {{pick::봄::여름::가을::겨울}}', '셋'], selected: 1, translations: new Map() });
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, folded().find((message) => message.id === said)!, '안녕하세요', null);
    // A reply cut at its limit, then continued (이어 쓰기), whose cut call's cost is booked later.
    const reply = crypto.randomUUID();
    const cut: Receipt = { ...pending, state: 'cut', cut: 'length' };
    await appendReply(store, source, { id: reply, message: null, replaces: null, at: 1, text: '답', receipt: cut });
    const continued = crypto.randomUUID();
    await appendReply(store, source, { id: continued, message: reply, replaces: reply, at: 2, text: '답장', receipt: { ...pending, cost: null, replyId: null, continues: cut } });
    await appendCost(store, source, 'r1', { unit: 'usd', amount: 0.01, source: 'reported' });
    await appendTranslation(store, source, continued, { text: 'A reply', receipt: pending, at: 3 }, crypto.randomUUID());
    await appendUserMessage(store, source, { id: deleted, text: '지울 말' });
    await removeMessage(store, source, deleted);
    await store.batch(
      Array.from({ length: BATCH_LIMITS.items + 1 }, (_, index) => ({
        type: 'create' as const,
        kind: 'entry' as const,
        id: crypto.randomUUID(),
        parent: source,
        value: { type: 'message' as const, role: 'user' as const, at: index, text: `말 ${index} {{random}}`, receipt: null },
      })),
    );
    await appendUserMessage(store, source, { id: split, text: '여기서' });
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '갈래에 없는 말' });
    const item: ChatItem = { id: source, chat, messages: folded(), count: folded().length, title: '기숙사의 밤', preview: '', at: null, order: 0 };
    expect(shown(item.messages[1]!).seed).toBe(said);

    const requests = vi.spyOn(globalThis, 'fetch');
    const branched = await branchChat(store, item, split);
    if (!branched.ok) throw new Error(branched.error);
    const entries = store.children('entry', branched.data);
    expect(entries.length).toBeGreaterThan(BATCH_LIMITS.items);
    const batches = requests.mock.calls.filter(([url]) => url === '/api/objects/batch').map(([, init]) => (JSON.parse(init!.body as string) as { writes: { id: string }[] }).writes);
    expect(batches.map((batch) => batch.length)).toEqual([BATCH_LIMITS.items, entries.length + 1 - BATCH_LIMITS.items]);
    expect(batches.at(-1)!.at(-1)!.id).toBe(branched.data);
    const copy = fold(entries);
    const withoutIds = (messages: Message[]) =>
      messages.map(({ role, at, selected, versions }) => ({ role, at, selected, versions: versions.map(({ seed, text, receipt, edited, at: written, translation }) => ({ seed, text, receipt, edited, written, translation })) }));
    expect(withoutIds(copy)).toEqual(withoutIds(item.messages.slice(0, -1)));
    expect([copy[0]!.versions.length, shown(copy[1]!).text, shown(copy[1]!).edited]).toEqual([3, '안녕하세요', true]);
    expect([shown(copy[2]!).text, copy[2]!.versions.length, calls(shown(copy[2]!).receipt!).map((call) => call.cost)]).toEqual(['답장', 1, [{ unit: 'usd', amount: 0.01, source: 'reported' }, null]]);
    const stored = store.get('chat', branched.data)!;
    expect(stored.value).toEqual({ ...chat, title: null, origin: { id: source, name: '기숙사의 밤', after: copy.at(-1)!.id }, seed: source });
    const reader = { store, username: 'jin' };
    expect(displayChat(reader, branched.data, stored.value, copy)).toEqual(displayChat(reader, source, chat, item.messages.slice(0, -1)));
    expect(stored.rev).toBeGreaterThan(Math.max(...entries.map((entry) => entry.rev)));
  });
  it('carries the memory records whose every message lies before the split, their sources remapped, with the facts and threads they or the user set', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, source, chat, null);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) await appendUserMessage(store, source, { id, text: `말 ${index}` });
    await editMessage(store, source, fold(store.children('entry', source))[1]!, '고친 말', null);
    const messages = fold(store.children('entry', source));
    const sourcesOf = (from: number, to: number) => messages.slice(from, to).map((message) => ({ message: message.id, version: shown(message).id }));
    const record = (id: string, sources: MemoryRecord['sources']): MemoryRecord => ({ id, sources, print: 'p', when: null, where: null, who: [], what: id, lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null, at: 0 });
    await store.create(
      'memory',
      {
        records: [record('before', sourcesOf(0, 2)), record('across', sourcesOf(2, 4))],
        state: [
          { about: 'Luna', field: 'mood', value: 'calm', record: 'before' },
          { about: 'Luna', field: 'place', value: 'pier', record: 'across' },
          { about: 'jin', field: 'name', value: 'Jin', record: null },
        ],
        threads: [
          { id: 't1', text: 'A promise', opened: 'across' },
          { id: 't2', text: 'The user’s own', opened: null },
        ],
      },
      { id: memoryId(source), parent: source },
    );
    const item: ChatItem = { id: source, chat, messages, count: messages.length, title: '', preview: '', at: null, order: 0 };
    const branched = await branchChat(store, item, ids[2]!);
    if (!branched.ok) throw new Error(branched.error);
    const copy = fold(store.children('entry', branched.data));
    const memory = store.get('memory', memoryId(branched.data))!.value;
    expect(memory.records.map(({ id, sources }) => [id, sources])).toEqual([['before', copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }))]]);
    expect(memory.state.map(({ field }) => field)).toEqual(['mood', 'name']);
    expect(memory.threads.map(({ id }) => id)).toEqual(['t2']);
  });
});
