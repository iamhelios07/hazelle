import { describe, expect, it, vi } from 'vitest';
import type { Trigger } from '../engine/import/types';
import { Lua } from '../engine/lua/run';
import { fold, modelUsage, shown } from '../model/chat';
import { setToggle } from './characters';
import { appendUserMessage, startChat } from './chat-log';
import type { Runner } from './lua/client';
import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testCard, testServer } from './testing';
import { displayChat, takeTurn } from './turn';

const server = testServer();

// A chat with a character whose triggers are these, or the one Lua trigger of this code, opened on its greeting.
async function chatWith(session: Session, script: string | Trigger[], toggles = '') {
  await answerable(session);
  const triggers: Trigger[] = typeof script === 'string' ? [{ kind: 'lua', name: 'main', code: script }] : script;
  const card = { ...testCard('루나'), greetings: ['어서 와.'], description: 'turn {{getvar::turn}}', triggers, toggles };
  const character = await session.store.create('character', { card, folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const greeting = crypto.randomUUID();
  await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, { ids: [greeting], texts: card.greetings, selected: 0, translations: new Map() });
  const messages = () => fold(session.store.children('entry', chat));
  const shownTexts = () => displayChat(session, chat, session.store.get('chat', chat)!.value, messages()).texts;
  return { chat, messages, shownTexts };
}

describe("a turn with the bot's Lua", () => {
  it('runs input, start, the edit hooks and output in order, saving what each wrote where the story replays it', () =>
    server.withSession(async (session) => {
      const { chat, messages, shownTexts } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'order', 'input') end
        listenEdit('editInput', function(id, value) return value .. ' [' .. getChatVar(id, 'order') .. ']' end)
        function onStart(id)
          setChatVar(id, 'turn', getChatLength(id) .. ':' .. getChat(id, -1).data)
          addChat(id, 'char', 'narration')
        end
        listenEdit('editOutput', function(id, value) return value .. ' (' .. getChatVar(id, 'turn') .. ')' end)
        listenEdit('edit' .. 'Request', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)
        function onOutput(id)
          setState(id, 'seen', getChat(id, -1).data)
          setChat(id, -1, getChat(id, -1).data .. '!')
        end`,
      );
      const log = stubRelay(() => saying('왔구나 {{getvar::turn}}'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => messages().length).toBe(4);

      const [, said, narration, reply] = messages();
      expect(shown(said!)).toMatchObject({ text: '안녕 [input]', before: [['order', 'input']] });
      expect(shown(narration!)).toMatchObject({ text: 'narration', staged: true });
      await expect.poll(() => shown(messages()[3]!).edited).toBe(true);
      expect(shown(messages()[3]!)).toMatchObject({ text: '왔구나 1:안녕 [input] (1:안녕 [input])!', staged: true, before: [['turn', '1:안녕 [input]']], after: [['__seen', '"왔구나 1:안녕 [input] (1:안녕 [input])"']] });
      expect(reply!.versions).toHaveLength(1);
      expect(shownTexts().at(-1)).toBe('왔구나 1:안녕 [input] (1:안녕 [input])!');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('turn 1:안녕 [input]');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('narration');
      expect((JSON.parse(log[0]!.sent.body!) as { messages: unknown[] }).messages.at(-1)).toEqual({ role: 'system', content: 'from lua' });
    }));

  it('ends the turn before any request on stopChat, keeping the message and what was written', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function onStart(id) setChatVar(id, 'handled', getChat(id, -1).data) stopChat(id) end`);
      const log = stubRelay(() => saying('never'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '/roll' })).toBeNull();
      expect(log).toHaveLength(0);
      expect(shown(messages()[1]!)).toMatchObject({ text: '/roll', after: [['handled', '/roll']] });
    }));

  it('ends the turn on a stopChat from onInput, running nothing after it and keeping the message with what was written', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'seen', '1') stopChat(id) end
        listenEdit('editInput', function(id, value) return value .. ' edited' end)
        function onStart(id) setChatVar(id, 'started', '1') end`,
      );
      const log = stubRelay(() => saying('never'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '/roll' })).toBeNull();
      expect(log).toHaveLength(0);
      expect(messages()).toHaveLength(2);
      expect(shown(messages()[1]!)).toMatchObject({ text: '/roll', before: [['seen', '1']] });
      expect(shown(messages()[1]!).after).toBeUndefined();
    }));

  it("asks before the bot's first model call, keeps the answer on the character, counts the call in the chat's usage, and ends it on the server", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `onOutput = async(function(id) setChatVar(id, 'made', LLM(id, { { role = 'user', content = 'sum' } }).result) end)`);
      const character = session.store.get('chat', chat)!.value.character!;
      const log = stubRelay(inTurn([saying('reply'), saying('summary')]));
      const served = globalThis.fetch;
      const calls: string[] = [];
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/streams/') && init?.method === 'POST') calls.push(url);
        return served(url, init);
      });
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => session.scripts.snapshot().questions).toMatchObject([{ chat, question: { kind: 'model' } }]);
      expect(log).toHaveLength(1);
      session.scripts.answer(session.scripts.snapshot().questions[0]!.id, 'yes');
      await expect.poll(() => shown(messages()[2]!).after).toEqual([['made', 'summary']]);
      expect(session.store.get('character', character)!.value.botModels).toBe(true);
      expect((JSON.parse(log[1]!.sent.body!) as { messages: unknown }).messages).toEqual([{ role: 'user', content: 'sum' }]);
      expect(shown(messages()[2]!).calls).toMatchObject([{ receipt: { state: 'done', model: 'm' } }]);
      expect(modelUsage([messages()], { connection: shown(messages()[2]!).receipt!.connection, model: 'm' }).calls).toBe(2);
      expect(calls).toHaveLength(2);
      await vi.waitFor(async () => expect((await fetch(calls[1]!)).status).toBe(404));
    }));

  it("answers a button with the script's function and keeps its writes after the last message", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function open(id) setChatVar(id, 'door', 'open') alertNormal(id, 'opened') end`);
      expect(await session.scripts.press(chat, { trigger: 'open' })).toBe(true);
      expect(await session.scripts.press(chat, { trigger: 'missing' })).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat, kind: 'said', tone: 'normal', text: 'opened' }]);
    }));

  it('answers a button with the block trigger of its name, whose texts are CBS over what it wrote', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, [
        { kind: 'blocks', name: 'open', on: 'manual', conditions: [], effects: [
          { type: 'v2SetVar', operator: '=', var: 'door', value: 'open', valueType: 'value', indent: 0 },
          { type: 'impersonate', role: 'char', value: 'The door is {{getvar::door}} at {{lastmessageid}}.' },
        ] },
      ]);
      expect(await session.scripts.press(chat, { trigger: 'open' })).toBe(true);
      expect(await session.scripts.press(chat, { trigger: 'missing' })).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(messages()[1]).toMatchObject({ role: 'assistant' });
      expect(shown(messages()[1]!)).toMatchObject({ text: 'The door is open at -1.', staged: true });
    }));
});

describe("the bot scripts' machine", () => {
  it('is ended when its session closes, one still being made then too', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { accountId, vaultKey } = await server.account();
    let made!: (runner: Runner) => void;
    const lua = vi.fn(() => new Promise<Runner>((resolve) => (made = resolve)));
    const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, lua);
    if (!opened.ok) throw new Error(opened.error);
    const { chat } = await chatWith(opened.data, `function open(id) end`);
    const pressed = opened.data.scripts.press(chat, { trigger: 'open' });
    await vi.waitFor(() => expect(lua).toHaveBeenCalledOnce());
    opened.data.close();
    const close = vi.fn();
    made({ run: () => Promise.reject(new Error('closed')), display: () => Promise.reject(new Error('closed')), close });
    await pressed;
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("the display with the bot's Lua", () => {
  it('shows each message after its editDisplay pass, with the state as of it, and again when the state changes', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(
        session,
        `listenEdit('editDisplay', function(id, value, meta) return value .. ' <' .. meta.index .. ':' .. getChatVar(id, 'hp') .. '>' end)
        function hit(id) setChatVar(id, 'hp', '9') end`,
      );
      stubRelay(() => saying('왔구나'));
      await takeTurn(session, chat, { kind: 'send', text: '안녕' });
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, opening);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      expect(screen.snapshot().display.texts).toEqual(['', '', '']);
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:null>', '안녕 <0:null>', '왔구나 <1:null>']);
      await session.scripts.press(chat, { trigger: 'hit' });
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:null>', '안녕 <0:null>', '왔구나 <1:9>']);
      leave();
    }));

  it('passes a message again when a toggle its listener reads changes', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editDisplay', function(id, value) return value .. ' <' .. getGlobalVar(id, 'toggle_hard') .. '>' end)`, 'hard=어렵게');
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, opening);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <0>']);
      await setToggle(session.store, opening.chat.character, 'hard', '1');
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <1>']);
      leave();
    }));

  it('passes again, after reloadDisplay, the messages of a stretch that was running when it was asked', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `listenEdit('editDisplay', function(id, value) return value end)\nfunction again(id) reloadDisplay(id) end`);
      for (let said = 0; said < 9; said++) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      const run = Lua.prototype.display;
      const passed: number[][] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      // The second stretch, of the two oldest messages, is held until reloadDisplay has been asked, and long enough
      // that the stretch after it is a short one of the newest.
      const display = vi.spyOn(Lua.prototype, 'display').mockImplementation(async function (this: Lua, owner, scripts, snapshot, items) {
        const shown = await run.call(this, owner, scripts, snapshot, items);
        if (passed.push(items.map(({ index }) => index)) === 2) await held;
        return shown;
      });
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, opening);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      await vi.waitFor(() => expect(passed).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [-1, 0]]));
      await session.scripts.press(chat, { trigger: 'again' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await vi.waitFor(() => expect(passed.slice(2).flat()).toContain(-1));
      display.mockRestore();
      leave();
    }));

  it('passes a chat whose script has no editDisplay listener once, until its engine has said so, and never again', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `-- editDisplay\nfunction onStart(id) end`);
      const display = vi.spyOn(Lua.prototype, 'display');
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, opening);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      expect(screen.snapshot().display.texts).toEqual(['']);
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와.']);
      screen.setInputs(opening, { width: 800, height: 800 });
      expect(screen.snapshot().display.texts).toEqual(['어서 와.']);
      expect(display).toHaveBeenCalledOnce();
      display.mockRestore();
      leave();
    }));
});
