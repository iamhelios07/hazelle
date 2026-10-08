import { describe, expect, it, vi } from 'vitest';
import { fetchApi } from './api';
import type { Trigger } from '../engine/import/types';
import { Lua } from '../engine/lua/run';
import { fold, modelUsage, shown, usageCalls } from '../model/chat';
import { setToggle } from './characters';
import { appendUserMessage, startChat } from './chat-log';
import { EvaluationFailed, EvaluationStuck } from './evaluation';
import { projectGreetings } from './greetings';
import type { Runner } from './lua/client';
import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testCard, testServer } from './testing';
import { evaluateChat } from './chat-context';
import { takeTurn } from './turn';

const server = testServer();

async function chatWith(session: Session, script: string | Trigger[], toggles = '') {
  await answerable(session);
  const triggers: Trigger[] = typeof script === 'string' ? [{ kind: 'lua', name: 'main', code: script }] : script;
  const card = { ...testCard('루나'), greetings: ['어서 와.'], description: 'turn {{getvar::turn}}', triggers, toggles };
  const character = await session.store.create('character', { card, folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const greeting = crypto.randomUUID();
  await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, projectGreetings(card.greetings, [greeting], 0));
  const messages = () => fold(session.store.children('entry', chat));
  const shownTexts = async () => (await evaluateChat(session, chat, session.store.get('chat', chat)!.value, messages())).texts;
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
      expect((await shownTexts()).at(-1)).toBe('왔구나 1:안녕 [input] (1:안녕 [input])!');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('turn 1:안녕 [input]');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('narration');
      expect((JSON.parse(log[0]!.sent.body!) as { messages: unknown[] }).messages.at(-1)).toEqual({ role: 'system', content: 'from lua' });
      const { prompt } = session.talk.sent(reply!.id)!;
      expect(prompt.parts).toHaveLength(prompt.messages.length);
      expect(prompt.parts.at(-1)).toMatchObject({ from: { kind: 'script' } });
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
      expect(modelUsage([usageCalls(messages())], { connection: shown(messages()[2]!).receipt!.connection, model: 'm' }).calls).toBe(2);
      expect(calls).toHaveLength(2);
      await vi.waitFor(async () => expect((await fetchApi(calls[1]!.slice('/api/'.length))).status).toBe(404));
    }));

  it("tells the chat when the server turns its bot's model call away for coming too often", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `onOutput = async(function(id) setChatVar(id, 'made', LLM(id, { { role = 'user', content = 'sum' } }).result) end)`);
      stubRelay(inTurn([saying('reply')]));
      const served = globalThis.fetch;
      let starts = 0;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
        url.startsWith('/api/streams/') && init?.method === 'POST' && starts++ ? Promise.resolve(Response.json({ error: 'too-many-bot-calls' }, { status: 429 })) : served(url, init),
      );
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => session.scripts.snapshot().questions).toHaveLength(1);
      session.scripts.answer(session.scripts.snapshot().questions[0]!.id, 'yes');
      await expect.poll(() => shown(messages()[2]!).after).toEqual([['made', 'Error: too many model calls in a minute']]);
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat, kind: 'flood' }]);
    }));

  it("answers a button with the script's function and keeps its writes after the last message", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function open(id) setChatVar(id, 'door', 'open') alertNormal(id, 'opened') end`);
      expect(await session.scripts.press(chat, { trigger: 'open' })).toBe(true);
      expect(await session.scripts.press(chat, { trigger: 'missing' })).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat, kind: 'said', tone: 'normal', text: 'opened' }]);
    }));

  it('keeps replayed CBS writes on Lua-edited versions after worker-side snapshot preparation', () =>
    server.withSession(async (session) => {
      const { chat, messages, shownTexts } = await chatWith(session, `function edit(id) setChat(id, 0, getChat(id, 0).data .. '!') end`);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '{{setvar::hp::7}}health {{getvar::hp}}' });
      expect(await session.scripts.press(chat, { trigger: 'edit' })).toBe(true);
      expect(shown(messages()[1]!)).toMatchObject({ text: 'health 7!', staged: true, before: [['hp', '7']] });
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'still {{getvar::hp}}' });
      expect((await shownTexts()).slice(-2)).toEqual(['health 7!', 'still 7']);
    }));

  it("tells a script's cbs() that ran away as the runaway note, not as its error", () =>
    server.withSession(async (session) => {
      const doubling = "'{{settempvar::x::abcdefghijklmnop}}' .. string.rep('{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}', 22)";
      const { chat } = await chatWith(session, `function grow(id) cbs(${doubling}) end`);
      expect(await session.scripts.press(chat, { trigger: 'grow' })).toBe(true);
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat, kind: 'runaway' }]);
    }));

  it('tells a display that did not end as the stuck note, not as an error', () =>
    server.withSession(async (session) => {
      session.scripts.report('c', new EvaluationStuck('Evaluation worker stuck', true));
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat: 'c', kind: 'stuck' }]);
    }));

  it('answers a button with the block trigger of its name, whose texts are CBS over what it wrote', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, [
        { kind: 'blocks', name: 'open', on: 'manual', conditions: [], effects: [
          { kind: 'set', operator: 'set', name: 'door', value: { kind: 'text', text: 'open' } },
          { kind: 'add', role: 'char', value: { kind: 'text', text: 'The door is {{getvar::door}} at {{lastmessageid}}.' } },
        ] },
      ]);
      expect(await session.scripts.press(chat, { trigger: 'open' })).toBe(true);
      expect(await session.scripts.press(chat, { trigger: 'missing' })).toBe(false);
      expect(messages()[0]!.after).toEqual([['door', 'open']]);
      expect(messages()[1]).toMatchObject({ role: 'assistant' });
      expect(shown(messages()[1]!)).toMatchObject({ text: 'The door is open at -1.', staged: true });
    }));
});

describe("a request the bot's Lua rewrote", () => {
  it('is reported, not lost, when the worker fails to count it', () =>
    server.withSession(async (session) => {
      const { chat } = await chatWith(session, `listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'from lua' } return value end)`);
      stubRelay(() => saying('왔구나'));
      vi.spyOn(session.store.evaluation, 'rewrite').mockRejectedValueOnce(new EvaluationFailed('crashed'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toMatchObject({ kind: 'unsent', failure: { ok: false, error: 'evaluation-unavailable' } });
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
    made({ run: () => Promise.reject(new Error('closed')), installDisplay: () => Promise.reject(new Error('closed')), forgetDisplay() {}, display: () => Promise.reject(new Error('closed')), close });
    await pressed;
    expect(close).toHaveBeenCalledOnce();
  });
});

// Lua's editDisplay stretches as the engine runs them, each held at the gate hold() set until that is let go, so the
// display shown before a pass lands can be read.
function luaDisplays() {
  const run = Lua.prototype.display;
  const display = vi.spyOn(Lua.prototype, 'display');
  const hold = () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    display.mockImplementation(async function (this: Lua, ...args) {
      await held;
      return run.apply(this, args);
    });
    return release;
  };
  return { display, hold };
}

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
      const lua = luaDisplays();
      const release = lua.hold();
      const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
      const screen = session.read.screen(chat, session.talk, opening);
      const leave = screen.subscribe(() => {});
      screen.setInputs(opening, { width: 1200, height: 800 });
      expect(screen.snapshot().pending).toBe(true);
      await vi.waitFor(() => expect(screen.snapshot().display.texts).toEqual(['', '', '']));
      release();
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:null>', '안녕 <0:null>', '왔구나 <1:null>']);
      await session.scripts.press(chat, { trigger: 'hit' });
      await expect.poll(() => screen.snapshot().display.texts).toEqual(['어서 와. <-1:null>', '안녕 <0:null>', '왔구나 <1:9>']);
      lua.display.mockRestore();
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
      const display = vi.spyOn(Lua.prototype, 'display').mockImplementation(async function (this: Lua, owner, generation, size) {
        const shown = await run.call(this, owner, generation, size);
        if (passed.push(Array.from({ length: shown.texts.length }, (_, at) => shown.from + at - 1)) === 2) await held;
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

  it('leaves it to the engine whether a script listens: one that only names the hook is passed once, one registered under a computed name is passed', () =>
    server.withSession(async (session) => {
      const open = async (script: string | Trigger[]) => {
        const { chat, messages } = await chatWith(session, script);
        const opening = { chat: session.store.get('chat', chat)!.value, messages: messages() };
        const screen = session.read.screen(chat, session.talk, opening);
        const leave = screen.subscribe(() => {});
        screen.setInputs(opening, { width: 1200, height: 800 });
        return { texts: () => screen.snapshot().display.texts, again: () => screen.setInputs(opening, { width: 800, height: 800 }), leave };
      };
      const { display, hold } = luaDisplays();
      let release = hold();
      const named = await open(`-- editDisplay\nfunction onStart(id) end`);
      await vi.waitFor(() => expect(named.texts()).toEqual(['']));
      release();
      await expect.poll(named.texts).toEqual(['어서 와.']);
      named.again();
      expect(named.texts()).toEqual(['어서 와.']);
      expect(display).toHaveBeenCalledOnce();
      named.leave();

      release = hold();
      const computed = await open(`listenEdit('edit' .. 'Display', function(id, value) return value .. '!' end)`);
      await vi.waitFor(() => expect(computed.texts()).toEqual(['어서 와.']));
      release();
      await expect.poll(computed.texts).toEqual(['어서 와.!']);
      computed.leave();

      display.mockClear();
      const mixed = await open([
        { kind: 'lua', name: 'named', code: `-- editDisplay\nfunction onInput(id) end` },
        { kind: 'lua', name: 'listening', code: `listenEdit('editDisplay', function(id, value) return value .. '?' end)` },
      ]);
      await expect.poll(mixed.texts).toEqual(['어서 와.?']);
      mixed.again();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(display).toHaveBeenCalledOnce();
      mixed.leave();
      display.mockRestore();
    }));
});
