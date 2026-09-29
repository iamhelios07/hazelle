import { describe, expect, it } from 'vitest';
import { calls, fold, shown, type Chat, type ChatItem, type Message, type Receipt } from '../model/chat';
import { appendCost, appendReply, appendUserMessage, branchChat, editMessage, removeMessage, startChat } from './chat-log';
import { testServer } from './testing';
import { displayChat } from './turn';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included, under the ids it was shown with, so its tags roll the same', async () => {
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
      expect(await startChat(store, id, chat, { ids: versions.map((version) => version.id), texts, selected })).toEqual({ ok: true });
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
    const pending: Receipt = { connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: 'pending', replyId: 'r1', firstTextMs: 100, totalMs: 900 };
    const said = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    const split = crypto.randomUUID();
    const folded = () => fold(store.children('entry', source));

    await startChat(store, source, chat, { ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], texts: ['하나', '둘 {{random::빨강::파랑::노랑::초록}} {{pick::봄::여름::가을::겨울}}', '셋'], selected: 1 });
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, folded().find((message) => message.id === said)!, '안녕하세요');
    // A reply cut at its limit, then continued (이어 쓰기), whose cut call's cost is booked later.
    const reply = crypto.randomUUID();
    const cut: Receipt = { ...pending, state: 'cut', cut: 'length' };
    await appendReply(store, source, { id: reply, message: null, replaces: null, at: 1, text: '답', receipt: cut });
    await appendReply(store, source, { id: crypto.randomUUID(), message: reply, replaces: reply, at: 2, text: '답장', receipt: { ...pending, cost: null, replyId: null, continues: cut } });
    await appendCost(store, source, 'r1', { unit: 'usd', amount: 0.01, source: 'reported' });
    await appendUserMessage(store, source, { id: deleted, text: '지울 말' });
    await removeMessage(store, source, deleted);
    await appendUserMessage(store, source, { id: split, text: '여기서' });
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '갈래에 없는 말' });
    const item: ChatItem = { id: source, chat, messages: folded(), title: '기숙사의 밤', preview: '', at: null, order: 0 };
    expect(shown(item.messages[1]!).seed).toBe(said);

    const branched = await branchChat(store, item, split);
    if (!branched.ok) throw new Error(branched.error);
    const entries = store.children('entry', branched.data);
    const copy = fold(entries);
    const withoutIds = (messages: Message[]) =>
      messages.map(({ role, at, selected, versions }) => ({ role, at, selected, versions: versions.map(({ seed, text, receipt, edited, at: written }) => ({ seed, text, receipt, edited, written })) }));
    expect(withoutIds(copy)).toEqual(withoutIds(item.messages.slice(0, 4)));
    expect([copy[0]!.versions.length, shown(copy[1]!).text, shown(copy[1]!).edited]).toEqual([3, '안녕하세요', true]);
    expect([shown(copy[2]!).text, copy[2]!.versions.length, calls(shown(copy[2]!).receipt!).map((call) => call.cost)]).toEqual(['답장', 1, [{ unit: 'usd', amount: 0.01, source: 'reported' }, null]]);
    const stored = store.get('chat', branched.data)!;
    expect(stored.value).toEqual({ ...chat, title: null, origin: { id: source, name: '기숙사의 밤', after: copy[3]!.id }, seed: source });
    const reader = { store, username: 'jin' };
    expect(displayChat(reader, branched.data, stored.value, copy)).toEqual(displayChat(reader, source, chat, item.messages.slice(0, 4)));
    expect(stored.rev).toBeGreaterThan(Math.max(...entries.map((entry) => entry.rev)));
  });
});
