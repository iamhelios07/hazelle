import { describe, expect, it, vi } from 'vitest';
import { calls, fold, shown, type Chat, type ChatItem, type Message, type Receipt } from '../model/chat';
import { memoryId, type MemoryRecord } from '../model/memory';
import { chatFile, readChatFile } from './chat-file';
import { appendCost, appendReply, appendScripted, appendTranslation, appendUserMessage, branchChat, editMessage, importChat, removeMessage, selectVersion, setCast, startChat } from './chat-log';
import type { Files } from './files';
import { summaryId } from './summary';
import { greetingPreview, projectGreetings } from './greetings';
import { BATCH_LIMITS, testServer } from './testing';
import { evaluateChat } from './chat-context';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included, under the ids it was shown with, so its tags roll the same, and never holds the chat without it', async () => {
    const { store } = await server.account();
    const reader = { store, username: 'jin' };
    const texts = ['하나 {{pick}} {{random}}', '둘', '셋'];
    const opened = async (selected: number) => {
      const id = crypto.randomUUID();
      await server.hold(store, id);
      const chat: Chat = { title: null, character: null, models: {} };
      const greetings = projectGreetings(texts, texts.map(() => crypto.randomUUID()), selected)!;
      const preview = greetingPreview(greetings, 0)!;
      const before = await evaluateChat(reader, id, chat, [preview]);
      let bare = false;
      const leave = store.subscribe(() => {
        bare ||= store.get('chat', id) !== null && store.children('entry', id).length === 0;
      });
      expect(await startChat(store, id, chat, greetings)).toBeNull();
      leave();
      expect(bare).toBe(false);
      const messages = fold(store.children('entry', id));
      expect(messages[0]!.versions.map((version) => version.id)).toEqual(preview.versions.map((version) => version.id));
      expect(await evaluateChat(reader, id, chat, messages)).toEqual(before);
      return [shown(messages[0]!).text, messages[0]!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나 {{pick}} {{random}}', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});

describe('setCast', () => {
  it("keeps each character once, never the chat's own, at most five, and none as no list", async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    expect(await startChat(store, id, { title: null, character: 'own', models: {} }, null)).toBeNull();
    await setCast(store, id, ['a', 'own', 'b', 'a', 'c', 'd', 'e', 'f']);
    expect(store.get('chat', id)!.value.cast).toEqual(['a', 'b', 'c', 'd', 'e']);
    await setCast(store, id, []);
    expect('cast' in store.get('chat', id)!.value).toBe(false);
  });
});

describe('branchChat', () => {
  it("carries what the bot's Lua wrote and the texts it staged", async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, source, chat, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕', before: [['order', 'input']] });
    const folded = () => fold(store.children('entry', source));
    await appendScripted(store, source, { edits: [{ message: folded()[0]!, text: '안녕!', wrote: [['typed', '1']] }], removed: [], added: [{ role: 'assistant', text: 'narration' }], vars: { version: said, set: [['hp', '9']] } });
    await appendScripted(store, source, { edits: [], removed: [], added: [], vars: { version: said, set: [['door', 'open']], stays: true } });
    const held = (messages: Message[]) => messages.map((message) => [shown(message).text, shown(message).staged, shown(message).before, shown(message).after, message.after]);
    expect(held(folded())).toEqual([['안녕!', true, [['order', 'input'], ['typed', '1']], [['hp', '9']], [['door', 'open']]], ['narration', true, undefined, undefined, undefined]]);

    const item: ChatItem = { id: source, chat, messages: folded(), count: 2, title: '', preview: '', at: null, order: 0 };
    const branched = await branchChat(store, item, folded()[1]!.id);
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data);
    expect(held(fold(store.children('entry', branched.data)))).toEqual(held(folded()));
  });

  it('copies the messages up to the split as they fold, rolling the same, without the deleted one, and saves the chat after them', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {}, note: '노트' };
    const pending: Receipt = { id: 'call', connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: 'pending', replyId: 'r1', firstTextMs: 100, totalMs: 900, cache: null };
    const said = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    const split = crypto.randomUUID();
    const folded = () => fold(store.children('entry', source));

    await startChat(store, source, chat, projectGreetings(['하나', '둘 {{random::빨강::파랑::노랑::초록}} {{pick::봄::여름::가을::겨울}}', '셋'], [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], 1));
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, folded().find((message) => message.id === said)!, '안녕하세요', null);
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
    await server.hold(store, branched.data);
    const entries = store.children('entry', branched.data);
    expect(entries.length).toBeGreaterThan(BATCH_LIMITS.items);
    const batches = requests.mock.calls.filter(([url]) => url === '/api/objects/batch').map(([, init]) => (JSON.parse(init!.body as string) as { writes: { id: string; kind: string }[] }).writes.filter(({ kind }) => kind !== 'summary')).filter((writes) => writes.length);
    expect(batches.flat()).toHaveLength(entries.length + 1);
    expect(batches.every((batch) => batch.length <= BATCH_LIMITS.items)).toBe(true);
    expect(batches.at(-1)!.at(-1)!.id).toBe(branched.data);
    const copy = fold(entries);
    const withoutIds = (messages: Message[]) =>
      messages.map(({ role, at, selected, versions }) => ({ role, at, selected, versions: versions.map(({ seed, text, receipt, edited, at: written, translation, greeting }) => ({ seed, text, receipt, edited, written, translation, greeting })) }));
    expect(withoutIds(copy)).toEqual(withoutIds(item.messages.slice(0, -1)));
    expect([copy[0]!.versions.length, shown(copy[1]!).text, shown(copy[1]!).edited]).toEqual([3, '안녕하세요', true]);
    expect([shown(copy[2]!).text, copy[2]!.versions.length, calls(shown(copy[2]!).receipt!).map((call) => call.cost)]).toEqual(['답장', 1, [{ unit: 'usd', amount: 0.01, source: 'reported' }, null]]);
    const stored = store.get('chat', branched.data)!;
    expect(stored.value).toEqual({ ...chat, title: null, origin: { id: source, name: '기숙사의 밤', after: copy.at(-1)!.id }, seed: source });
    const reader = { store, username: 'jin' };
    expect(await evaluateChat(reader, branched.data, stored.value, copy)).toEqual(await evaluateChat(reader, source, chat, item.messages.slice(0, -1)));
    expect(stored.rev).toBeGreaterThan(Math.max(...entries.map((entry) => entry.rev)));
  }, 15_000);
  it('carries the memory records whose every message lies before the split, their sources remapped, with the facts and threads as they stood before a later record changed them, and a chapter only with all its records and messages', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, source, chat, null);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) await appendUserMessage(store, source, { id, text: `말 ${index}` });
    await editMessage(store, source, fold(store.children('entry', source))[1]!, '고친 말', null);
    const messages = fold(store.children('entry', source));
    const sourcesOf = (from: number, to: number) => messages.slice(from, to).map((message) => ({ message: message.id, version: shown(message).id }));
    const record = (id: string, sources: MemoryRecord['sources'], changes: Pick<MemoryRecord, 'state' | 'opens' | 'closes'>): MemoryRecord => ({ id, sources, print: 'p', when: null, where: null, who: [], what: id, lines: [], outcome: '', receipt: null, at: 0, ...changes });
    const chapter = (id: string, records: string[]) => ({ id, sources: sourcesOf(0, 2 * records.length), print: 'p', when: null, where: null, who: [], what: id, lines: [], outcome: '', receipt: null, at: 0, records: records.map((each) => ({ id: each, at: 0 })) });
    await store.create(
      'memory',
      {
        records: [
          record('before', sourcesOf(0, 2), { state: [{ about: 'Luna', field: 'mood', value: 'calm' }, { about: 'Luna', field: 'place', value: 'home' }, { about: 'jin', field: 'coat', value: 'red' }], opens: ['A vow'], closes: [] }),
          record('across', sourcesOf(2, 4), { state: [{ about: 'Luna', field: 'place', value: 'pier' }], opens: ['A promise'], closes: ['A vow'] }),
        ],
        chapters: [chapter('kept', ['before']), chapter('split', ['before', 'across']), { ...chapter('read past', ['before']), sources: sourcesOf(0, 4) }],
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
    await server.hold(store, branched.data);
    const copy = fold(store.children('entry', branched.data));
    const memory = store.get('memory', memoryId(branched.data))!.value;
    expect(memory.records.map(({ id, sources }) => [id, sources])).toEqual([['before', copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }))]]);
    expect(memory.chapters.map(({ id, sources }) => [id, sources])).toEqual([['kept', copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }))]]);
    expect(memory.state.map(({ field, value, record }) => [field, value, record])).toEqual([['mood', 'calm', 'before'], ['name', 'Jin', null], ['place', 'home', 'before']]);
    expect(memory.threads.map(({ text, opened }) => [text, opened])).toEqual([['The user’s own', null], ['A vow', 'before']]);
  });
});

describe('importChat', () => {
  it('copies a chat file under new ids, folding as the source does, with its memory and illustrations remapped and what is not here left out and counted', async () => {
    const { store, files } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {}, note: '노트', prompt: crypto.randomUUID() };
    const receipt: Receipt = { id: 'call', connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null };
    await startChat(store, source, chat, projectGreetings(['하나', '둘', '셋'], [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], 1));
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, fold(store.children('entry', source)).find((message) => message.id === said)!, '안녕하세요', null);
    const reply = crypto.randomUUID();
    await appendReply(store, source, { id: reply, message: null, replaces: null, at: 1, text: '답', receipt });
    await appendReply(store, source, { id: crypto.randomUUID(), message: reply, replaces: null, at: 2, text: '다른 답', receipt });
    await selectVersion(store, source, reply, reply);
    await appendTranslation(store, source, reply, { text: 'A reply', receipt: null, at: 3 }, crypto.randomUUID());
    const messages = fold(store.children('entry', source));
    const sources = messages.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }));
    await store.create('memory', { records: [{ id: 'r', sources, print: 'p', when: null, where: null, who: [], what: 'w', lines: [], outcome: '', receipt: null, at: 0, state: [], opens: [], closes: [] }], state: [], threads: [], chapters: [] }, { id: memoryId(source), parent: source });

    const picture = new Uint8Array([1, 2, 3]);
    const stored = await files.save([picture]);
    const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
    const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
    await store.create('illustration', { message: reply, version: reply, scene, receipt: null, model: { connection: 'c', model: 'm' }, sent, file: stored.ok ? stored.data[0]! : { id: '', key: '' }, type: 'image/png', size: 3, at: 4 }, { parent: source });

    const written = await chatFile({ store, files }, source);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    const { id, dropped } = imported.data;
    expect(dropped).toEqual({ prompt: 1, persona: 0, cast: 0, models: 0, pictures: 0 });
    expect(store.get('summary', summaryId(id))).not.toBeNull();
    await server.hold(store, id);
    const copy = fold(store.children('entry', id));
    const seen = (folded: Message[]) => folded.map((message) => [message.selected, message.versions.map(({ text, translation, greeting, edited }) => [text, translation?.text, greeting, edited])]);
    expect(seen(copy)).toEqual(seen(messages));
    const before = new Set(store.children('entry', source).map((entry) => entry.id));
    expect(store.children('entry', id).some((entry) => before.has(entry.id))).toBe(false);
    expect(store.get('chat', id)!.value).toEqual({ title: '기숙사의 밤', character: null, models: {}, note: '노트', seed: source });
    expect(store.get('memory', memoryId(id))!.value.records[0]!.sources).toEqual(copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id })));
    const [illustration] = store.children('illustration', id);
    const replied = copy.find((message) => message.versions.some(({ text }) => text === '답'))!;
    expect(illustration?.value).toMatchObject({ message: replied.id, version: replied.versions.find(({ text }) => text === '답')!.id });
    const opened = await files.read(illustration!.value.file);
    expect(opened.ok && [...opened.data]).toEqual([1, 2, 3]);

    const refusing = { save: async (bytes: unknown[]) => ({ ok: true, data: bytes.map(() => null) }) } as unknown as Files;
    const refused = await importChat({ store, files: refusing }, read.file, null);
    if (!refused.ok) throw new Error(refused.error);
    await server.hold(store, refused.data.id);
    expect([refused.data.dropped.pictures, store.children('illustration', refused.data.id).length]).toEqual([1, 0]);
  });
});
