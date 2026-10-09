import { importModule, setModuleAlways } from './modules';
import { importTool } from './tools/store';
import { readTool } from '../engine/import/tool';
import { toolVar, type ToolUnit } from '../model/tool';
import { noOutcome, type Binding } from './script-binding';
import type { ScriptOutcome } from './lua/event';
import { gatherTurn, wouldSend } from './turn-context';
import type { LuaRunner } from './script-binding';
import { describe, expect, it, vi } from 'vitest';
import { fetchApi } from './api';
import type { Trigger } from '../engine/import/types';
import { Lua } from '../engine/lua/run';
import { fold, modelUsage, shown, usageCalls } from '../model/chat';
import { setToggle } from './characters';
import { appendUserMessage, selectVersion, startChat } from './chat-log';
import { EvaluationFailed, EvaluationStuck } from './evaluation';
import { projectGreetings } from './greetings';

import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testCard, testServer } from './testing';
import { evaluateChat } from './chat-context';
import { triggersOf } from './scripts';
import { takeTurn } from './turn';

const server = testServer();

async function chatWith(session: Session, script: string | Trigger[], toggles = '') {
  await answerable(session);
  const triggers: Trigger[] = typeof script === 'string' ? [{ kind: 'lua', id: 'trigger-0', name: 'main', code: script }] : script;
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

describe('triggersOf', () => {
  it('leaves out a trigger turned off and a Lua one with no code', () => {
    const lua = (id: string, code: string, off?: true): Trigger => ({ kind: 'lua', id, name: id, code, ...(off && { off }) });
    expect(triggersOf([{ id: 'c', module: null, pack: { regex: [], triggers: [lua('a', 'x()'), lua('b', ' \n'), lua('c', 'y()', true)], toggles: '' } }]).map(({ id }) => id)).toEqual(['a']);
  });
});

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
        { kind: 'blocks', id: 'trigger-0', name: 'open', on: 'manual', conditions: [], effects: [
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
    let made!: (runner: LuaRunner) => void;
    const lua = vi.fn(() => new Promise<LuaRunner>((resolve) => (made = resolve)));
    const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, { lua });
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
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening);
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
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening);
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
      const screen = session.read.screen(chat, session.talk, session.illustrator, opening);
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
        const screen = session.read.screen(chat, session.talk, session.illustrator, opening);
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
        { kind: 'lua', id: 'trigger-0', name: 'named', code: `-- editDisplay\nfunction onInput(id) end` },
        { kind: 'lua', id: 'trigger-1', name: 'listening', code: `listenEdit('editDisplay', function(id, value) return value .. '?' end)` },
      ]);
      await expect.poll(mixed.texts).toEqual(['어서 와.?']);
      mixed.again();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(display).toHaveBeenCalledOnce();
      mixed.leave();
      display.mockRestore();
    }));
});


async function toolChat(session: Session) {
  await answerable(session);
  const parsed = readTool(new TextEncoder().encode('//@api 1\n//@name notes\n//@author jin\n//@display-name 메모\n//@uses model\n//@menu now 지금 정리'));
  if (!parsed.ok) throw new Error('fixture');
  const added = await importTool(session.store, session.files, parsed.tool);
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  return { chat, module: added.data.id, variable: toolVar(parsed.tool.manifest, 'summary'), messages: () => fold(session.store.children('entry', chat)) };
}

describe('tool events through Scripts', () => {
  it('adds live slot text and before writes to a turn, reuses its forecast, and never starts Lua', async () => {
    let variable = '';
    const run = vi.fn<Binding<ToolUnit>['run']>(async (_chat, _units, _scope, event) => ({ ...noOutcome(), ...(event.kind === 'prompt' && { value: 'tool summary', writes: [[variable, '"prepared"']] as [string, string][] }) }));
    const binding = { run, close: () => {} };
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      variable = fixture.variable;
      const lua = vi.spyOn(Lua.prototype, 'run');
      const log = stubRelay(() => saying('reply'));
      expect(await takeTurn(session, fixture.chat, { kind: 'send', text: 'hello' })).toBeNull();
      await expect.poll(() => fixture.messages().length).toBe(2);
      expect(shown(fixture.messages()[1]!).before).toEqual([[variable, '"prepared"']]);
      expect(log[0]!.sent.body).toContain('tool summary');
      expect(session.talk.sent(shown(fixture.messages()[1]!).id)!.prompt.parts).toContainEqual(expect.objectContaining({ from: { kind: 'tool', name: '메모' } }));
      const prompts = () => run.mock.calls.filter((args) => args[3].kind === 'prompt').length;
      expect(prompts()).toBe(1);
      expect((await wouldSend(session, fixture.chat, { kind: 'answer' }))!.prompt.messages.some(({ content }) => content === 'tool summary')).toBe(true);
      expect(prompts()).toBe(1);
      expect(lua).not.toHaveBeenCalled();
    }, binding);
  });

  it('anchors a delayed reply write to its saved version across regeneration', async () => {
    let finish!: (outcome: ScriptOutcome) => void;
    let replies = 0;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, _scope, event) => {
      if (event.kind === 'reply' && replies++ === 0) return new Promise<ScriptOutcome>((resolve) => { finish = resolve; });
      return noOutcome();
    }, close: () => {} };
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      stubRelay(() => saying('reply'));
      await takeTurn(session, fixture.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => replies).toBe(1);
      const original = shown(fixture.messages()[1]!).id;
      await takeTurn(session, fixture.chat, { kind: 'regenerate', message: fixture.messages()[1]!.id });
      await expect.poll(() => fixture.messages()[1]!.versions.length).toBe(2);
      finish({ ...noOutcome(), writes: [[fixture.variable, '"old summary"']] });
      await expect.poll(() => session.store.children('entry', fixture.chat).some(({ value }) => value.type === 'vars' && value.version === original)).toBe(true);
      expect(shown(fixture.messages()[1]!).after ?? []).toEqual([]);
      await selectVersion(session.store, fixture.chat, fixture.messages()[1]!.id, original);
      expect(shown(fixture.messages()[1]!).after).toEqual([[fixture.variable, '"old summary"']]);
    }, binding);
  });

  it.each([false, true])('guards delayed reply edits and adds when the story advances: %s', async (advance) => {
    let finish!: (outcome: ScriptOutcome) => void;
    const binding: Binding<ToolUnit> = { run: async (_chat, _units, _scope, event) => event.kind === 'reply' ? new Promise((resolve) => { finish = resolve; }) : noOutcome(), close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      stubRelay(() => saying('reply'));
      await takeTurn(session, f.chat, { kind: 'send', text: 'hello' });
      await expect.poll(() => finish).toBeDefined();
      if (advance) await appendUserMessage(session.store, f.chat, { id: crypto.randomUUID(), text: 'newer' });
      finish({ ...noOutcome(), writes: [[f.variable, '"saved"']], edits: [{ index: 0, text: 'changed user', wrote: [] }, { index: 1, text: 'changed reply', wrote: [] }], added: [{ role: 'char', text: 'added' }] });
      await expect.poll(() => shown(f.messages()[1]!).text).toBe('changed reply');
      expect(shown(f.messages()[0]!).text).toBe(advance ? 'hello' : 'changed user');
      expect(shown(f.messages().at(-1)!).text).toBe(advance ? 'newer' : 'added');
      expect(session.store.children('entry', f.chat).some(({ value }) => value.type === 'vars' && value.set.some(([key]) => key === f.variable))).toBe(true);
      expect(session.scripts.snapshot().notes.filter(({ kind }) => kind === 'stale-reply')).toHaveLength(advance ? 1 : 0);
    }, binding);
  });

  it('forgets forecast text when a tool leaves or a chat unloads', async () => {
    const binding: Binding<ToolUnit> = { run: async () => ({ ...noOutcome(), value: 'cached' }), close: () => {} };
    await server.withSession(async (session) => {
      const f = await toolChat(session);
      const chat = crypto.randomUUID();
      let lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
      const cache = async () => {
        await session.store.projections.evaluate(chat);
        const gather = () => gatherTurn(session, chat, { kind: 'answer' });
        const turn = gather();
        if (!turn || 'kind' in turn) throw new Error('fixture');
        await session.scripts.prompting(chat, turn, async () => gather(), new AbortController().signal);
        expect(session.scripts.cachedTools(chat)).toHaveLength(1);
      };
      try {
        await cache();
        await setModuleAlways(session.store, f.module, false);
        await setModuleAlways(session.store, f.module, true);
        expect(session.scripts.cachedTools(chat)).toEqual([]);
        await cache();
        lease.release();
        await expect.poll(() => session.store.scopeState(chat)).toBe('unloaded');
        lease = session.store.retainChat(chat);
        await lease.ready;
        expect(session.scripts.cachedTools(chat)).toEqual([]);
      } finally { lease.release(); }
    }, binding);
  });

  it('skips a prompt after its deadline, drops late writes, and notes that tool only once', async () => {
    const finish: ((outcome: ScriptOutcome) => void)[] = [];
    const run = vi.fn<Binding<ToolUnit>['run']>(() => new Promise((resolve) => finish.push(resolve))).mockResolvedValueOnce({ ...noOutcome(), value: 'previous summary' });
    await server.withSession(async (session) => {
      const fixture = await toolChat(session);
      await appendUserMessage(session.store, fixture.chat, { id: crypto.randomUUID(), text: 'hello' });
      await session.store.projections.evaluate(fixture.chat);
      const gather = () => gatherTurn(session, fixture.chat, { kind: 'answer' });
      const turn = gather();
      if (!turn || 'kind' in turn) throw new Error('fixture');
      await session.scripts.prompting(fixture.chat, turn, async () => gather(), new AbortController().signal);
      expect(session.scripts.cachedTools(fixture.chat)).toHaveLength(1);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const prompt = session.scripts.prompting(fixture.chat, turn, async () => gather(), new AbortController().signal);
          await vi.advanceTimersByTimeAsync(0);
          expect(run).toHaveBeenCalledTimes(attempt + 2);
          await vi.advanceTimersByTimeAsync(5001);
          expect(await prompt).toMatchObject({ tools: [], turn: { reply: { before: [] } } });
          expect(session.scripts.cachedTools(fixture.chat)).toEqual([]);
          finish[attempt]!({ ...noOutcome(), value: 'too late', writes: [[fixture.variable, 'late']] });
        }
        expect(session.scripts.snapshot().notes.filter(({ kind }) => kind === 'late')).toMatchObject([{ from: { kind: 'module', id: fixture.module } }]);
        expect(session.store.children('entry', fixture.chat).filter(({ value }) => value.type === 'vars')).toEqual([]);
      } finally { vi.useRealTimers(); for (const resolve of finish) resolve(noOutcome()); }
    }, { run, close: () => {} });
  });

  it('asks module Lua on its own behalf even with no character, and remembers it in another chat', () => server.withSession(async (session) => {
    await answerable(session);
    const added = await importModule(session.store, session.files, { name: 'module', description: '', namespace: null, risu: null, pack: { regex: [], toggles: '', triggers: [{ kind: 'lua', id: 'lua', name: 'model', code: 'askModel = async(function(id) LLM(id, {{role="user", content="summarize"}}) end)' }] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
    if (!added.ok) throw new Error(added.error);
    await setModuleAlways(session.store, added.data.id, true);
    const log = stubRelay(() => saying('summary'));
    for (let index = 0; index < 2; index++) {
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
      const pressed = session.scripts.press(chat, { trigger: 'askModel' });
      if (!index) {
        await expect.poll(() => session.scripts.snapshot().questions).toMatchObject([{ from: { kind: 'module', id: added.data.id }, question: { kind: 'model' } }]);
        session.scripts.answer(session.scripts.snapshot().questions[0]!.id, 'yes');
      }
      await pressed;
      expect(session.store.get('module', added.data.id)!.value.botModels).toBe(true);
      expect(session.scripts.snapshot().questions).toEqual([]);
    }
    expect(log).toHaveLength(2);
  }));
});
