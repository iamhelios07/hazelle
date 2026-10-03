import { describe, expect, it, vi } from 'vitest';
import { LuaFactory } from 'wasmoon';
import type { Trigger } from '../import/types';
import { Lua, type Event, type Script } from './run';
import type { Host, Snapshot } from './state';

const SNAPSHOT: Snapshot = {
  messages: [
    { role: 'user', data: 'hello', time: 1 },
    { role: 'char', data: 'hi there', time: 2 },
  ],
  variables: [['hp', '10']],
  globals: [['toggle_hard', '1']],
  character: { name: 'Mina', description: 'a guide', firstMessage: 'welcome' },
  persona: { name: 'Jin', description: 'a traveler' },
  note: '',
  scope: {
    card: null,
    persona: { name: 'Jin', description: 'a traveler' },
    prompt: null,
    note: null,
    lore: [{ id: 'l1', value: { name: 'Gate', keys: ['gate', 'door'], secondaryKeys: [], content: 'hp {{getvar::hp}}', enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 7, priority: null, position: null } }],
    messages: [],
    variables: [],
    greeting: null,
    model: null,
    clock: { now: 0, timeZone: 'UTC' },
    assets: [],
    modules: [],
    faces: { char: null, user: null },
    screen: null,
    pick: 'test',
  },
};

const host = (over: Partial<Host> = {}): Host & { said: string[] } => {
  const said: string[] = [];
  return { said, say: (kind, text) => void said.push(`${kind}:${text}`), ask: async () => null, model: async () => ({ success: true, result: 'made' }), tokens: async (text) => text.length, lore: async () => [{ role: 'assistant', text: 'active' }], ...over };
};

const lua = await Lua.create({ sliceMs: 300 });
let owner = 0;
const run = (code: string, event: Event, over: Partial<Host> = {}, snapshot = SNAPSHOT) => lua.run(String(owner++), [{ kind: 'lua', name: 'main', code }], snapshot, event, host(over));
const blocks = (on: string, effects: unknown[], conditions: unknown[] = []): Trigger => ({ kind: 'blocks', name: 'blocks', on, conditions, effects });

describe('Lua runs', () => {
  it('pins complete nine-script worksets across stretches and lanes, then evicts idle worksets as a whole', async () => {
    const machine = await Lua.create();
    const starts = vi.spyOn(LuaFactory.prototype, 'createEngine');
    const scripts: Script[] = Array.from({ length: 9 }, (_, index) => ({ kind: 'lua', name: String(index), code: `
      local counter = 0
      function onStart(id) counter = counter + 1; setChatVar(id, 's${index}', counter) end
      listenEdit('editDisplay', function(id, value) counter = counter + 1; return value .. ':' .. counter end)
    ` }));
    const event = () => machine.run('active', scripts, SNAPSHOT, { kind: 'start' }, host());
    const display = () => machine.display('active', scripts, SNAPSHOT, [{ index: 0, text: '', variables: [] }]);
    try {
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('1'));
      expect((await display()).texts).toEqual([':1'.repeat(9)]);
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('2'));
      expect((await display()).texts).toEqual([':2'.repeat(9)]);
      expect(starts).toHaveBeenCalledTimes(18);
      await machine.run('next', scripts, SNAPSHOT, { kind: 'start' }, host());
      expect((await display()).texts).toEqual([':3'.repeat(9)]);
      expect((await event()).writes.map(([, value]) => value)).toEqual(Array(9).fill('1'));
      expect(starts).toHaveBeenCalledTimes(36);
    } finally {
      machine.close();
      starts.mockRestore();
    }
  });

  it('closes a retired run’s later engines after a host wait without closing a new run of the same owner', async () => {
    const machine = await Lua.create();
    const starts = vi.spyOn(LuaFactory.prototype, 'createEngine');
    let reached!: () => void;
    let answer!: (value: string | null) => void;
    const asked = new Promise<void>((resolve) => { reached = resolve; });
    const scripts: Script[] = [
      { kind: 'lua', name: 'wait', code: "onStart = async(function(id) alertInput(id, 'wait'):await() end)" },
      { kind: 'lua', name: 'later', code: "function onStart(id) setChatVar(id, 'later', 'done') end" },
    ];
    try {
      const old = machine.run('owner', scripts, SNAPSHOT, { kind: 'start' }, host({ ask: () => new Promise((resolve) => { answer = resolve; reached(); }) }));
      await asked;
      machine.close();
      await machine.run('owner', [scripts[1]!], SNAPSHOT, { kind: 'start' }, host());
      answer(null);
      expect(await old).toMatchObject({ errors: [], writes: [['later', 'done']] });
      const engines = await Promise.all(starts.mock.results.map(({ value }) => value));
      await vi.waitFor(() => expect(engines.map((engine) => engine.global.isClosed())).toEqual([true, false, true]));
      machine.close();
      await vi.waitFor(() => expect(engines.every((engine) => engine.global.isClosed())).toBe(true));
    } finally {
      machine.close();
      starts.mockRestore();
    }
  });

  it('reads and writes variables and state, reporting only what changed', async () => {
    const outcome = await run(
      `function onOutput(id)
        setChatVar(id, 'hp', tonumber(getChatVar(id, 'hp')) - 3)
        setChatVar(id, 'unset', getChatVar(id, 'missing'))
        setState(id, 'bag', { 'key', 'map' })
        setChatVar(id, 'seen', getState(id, 'bag')[2] .. getGlobalVar(id, 'toggle_hard'))
      end`,
      { kind: 'output' },
    );
    expect(outcome.errors).toEqual([]);
    expect(outcome.handled).toBe(true);
    expect(new Map(outcome.writes)).toEqual(new Map([['hp', '7'], ['unset', 'null'], ['__bag', '["key","map"]'], ['seen', 'map1']]));
  });

  it('turns chat writes into edits, removals and additions by the snapshot index', async () => {
    const outcome = await run(
      `function onOutput(id)
        local last = getChat(id, -1)
        setChat(id, -1, last.data .. '!' .. getChatLength(id) .. getFullChat(id)[1].role)
        addChat(id, 'user', 'more')
        removeChat(id, 0)
      end`,
      { kind: 'output' },
    );
    expect(outcome).toMatchObject({ errors: [], edits: [{ index: 1, text: 'hi there!2user' }], removed: [0], added: [{ role: 'user', text: 'more' }] });
  });

  it('awaits the host in an async handler and stops the turn on false or stopChat', async () => {
    const asked = await run(
      `onStart = async(function(id)
        local name = alertInput(id, 'name?'):await()
        local answer = LLM(id, { { role = 'user', content = name } })
        alertNormal(id, answer.result .. getTokens(id, 'four'):await())
        return false
      end)`,
      { kind: 'start' },
      { ask: async (question) => (question.kind === 'input' ? 'typed' : null), model: async (role, messages) => ({ success: true, result: `${role}:${messages[0]!.content}` }) },
    );
    expect(asked).toMatchObject({ errors: [], stop: true });
    expect((await run(`function onInput(id) stopChat(id) end`, { kind: 'input' })).stop).toBe(true);
  });

  it('chains edit listeners and keeps the value when one returns nothing', async () => {
    const code = `listenEdit('editOutput', function(id, value, meta) return value .. meta.index end)
      listenEdit('editOutput', function(id, value) end)`;
    expect((await run(code, { kind: 'edit', stage: 'editOutput', value: 'text', meta: { index: 4 } })).value).toBe('text4');
    const request = [{ role: 'user', content: 'a' }];
    expect((await run(`listenEdit('editRequest', function(id, value) value[#value + 1] = { role = 'system', content = 'b' } return value end)`, { kind: 'edit', stage: 'editRequest', value: request, meta: {} })).value).toEqual([...request, { role: 'system', content: 'b' }]);
  });

  it("calls a button's function only when the script defined it", async () => {
    const code = `function open(id) setChatVar(id, 'door', 'open') end
      function onButtonClick(id, data) setChatVar(id, 'pressed', data) end`;
    expect((await run(code, { kind: 'call', name: 'open' })).writes).toEqual([['door', 'open']]);
    expect((await run(code, { kind: 'button', data: 'b1' })).writes).toEqual([['pressed', 'b1']]);
    expect(await run(code, { kind: 'call', name: 'removeChat' })).toMatchObject({ handled: false, removed: [] });
    expect((await run(code, { kind: 'call', name: 'nothing' })).handled).toBe(false);
  });

  it('reports CBS its cbs() call ran away with as a runaway, and leaves one the script catches to it', async () => {
    const doubling = "'{{settempvar::x::abcdefghijklmnop}}' .. string.rep('{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}', 22)";
    expect((await run(`function onStart(id) cbs(${doubling}) end`, { kind: 'start' })).errors).toEqual([{ script: 'main', runaway: true }]);
    expect((await run(`function onStart(id) pcall(cbs, ${doubling}) end`, { kind: 'start' })).errors).toEqual([]);
  });

  it('reports an error with its line, a function this app lacks, and a script that never ends', async () => {
    const failed = await run(`function onStart(id)\n  local none = nil\n  return none.field\nend`, { kind: 'start' });
    expect(failed.errors[0]).toMatchObject({ message: expect.stringContaining('main:3:') });
    expect((await run(`function onStart(id) generateImage(id, 'x') setChatVar(id, 'after', '1') end`, { kind: 'start' }))).toMatchObject({ missing: ['generateImage'], writes: [['after', '1']] });
    expect((await run(`syntax error here`, { kind: 'start' })).errors).toHaveLength(1);
    expect((await run(`function onStart(id) while true do end end`, { kind: 'start' })).errors[0]).toMatchObject({ message: expect.stringContaining('timeout') });
  });

  it('evaluates CBS with the run\'s writes, reads the lorebook by name and as the prompt would hold it, and takes a whole chat', async () => {
    const outcome = await run(
      `onOutput = async(function(id)
        setChatVar(id, 'hp', '4')
        setChatVar(id, 'cbs', cbs('{{getvar::hp}}/{{user}}/{{getglobalvar::toggle_hard}}'))
        local gate = getLoreBooks(id, 'Gate')[1]
        setChatVar(id, 'gate', gate.key .. '|' .. gate.content .. '|' .. gate.insertorder .. '|' .. #getLoreBooks(id, 'None'))
        local active = loadLoreBooks(id)[1]
        setChatVar(id, 'active', active.role .. ':' .. active.data)
        setFullChat(id, { { role = 'user', data = 'hello!' }, { role = 'user', data = 'again' }, { role = 'char', data = 'new' } })
      end)`,
      { kind: 'output' },
    );
    expect(outcome.errors).toEqual([]);
    expect(new Map(outcome.writes)).toEqual(new Map([['hp', '4'], ['cbs', '4/Jin/1'], ['gate', 'gate, door|hp 4|7|0'], ['active', 'char:active']]));
    expect(outcome).toMatchObject({ edits: [{ index: 0, text: 'hello!' }], removed: [1], added: [{ role: 'user', text: 'again' }, { role: 'char', text: 'new' }] });
  });

  it('gives a script no way out of the sandbox', async () => {
    const outcome = await run(
      `function onStart(id)
        setChatVar(id, 'libs', tostring(io) .. tostring(require) .. tostring(load) .. tostring(debug) .. tostring(package) .. tostring(os.execute) .. tostring(dofile))
        setChatVar(id, 'date', type(os.date('%Y')))
        setChatVar(id, 'api', type(getChatVar) .. tostring(pcall(function() return getChatVar.constructor end)))
      end`,
      { kind: 'start' },
    );
    expect(new Map(outcome.writes)).toEqual(new Map([['libs', 'nil'.repeat(7)], ['date', 'string'], ['api', 'functionfalse']]));
  });
});

describe('Lua display', () => {
  it('edits each message with the state as of it and keeps none of its writes or acts', async () => {
    const code = `listenEdit('editDisplay', function(id, value, meta)
        alertNormal(id, 'never')
        setChat(id, 0, 'never')
        local hp = getChatVar(id, 'hp')
        setChatVar(id, 'hp', 'changed')
        return value .. ':' .. meta.index .. ':' .. hp .. ':' .. getChat(id, 0).data
      end)`;
    const shown = await lua.display('display', [{ kind: 'lua', name: 'main', code }], SNAPSHOT, [
      { index: 0, text: 'a', variables: [] },
      { index: 1, text: 'b', variables: [['hp', '4']] },
    ]);
    expect(shown).toEqual({ texts: ['a:0:10:hello', 'b:1:4:hello'], listening: [true], errors: [], missing: [] });
  });

  it('says which scripts listen by what their engines registered, a computed name too, not by their source', async () => {
    const scripts = [`-- editDisplay editRequest\nfunction onStart(id) end`, `listenEdit('edit' .. 'Display', function(id, value) return value .. '!' end)`].map((code): Script => ({ kind: 'lua', name: 'main', code }));
    expect(await lua.display('listening', scripts, SNAPSHOT, [{ index: 0, text: 'a', variables: [] }])).toMatchObject({ texts: ['a!'], listening: [false, true] });
    const request = [{ role: 'user', content: 'a' }];
    expect(await lua.run('listening', [scripts[0]!], SNAPSHOT, { kind: 'edit', stage: 'editRequest', value: request, meta: {} }, host())).toMatchObject({ value: request, handled: false });
    const computed = `listenEdit('edit' .. 'Request', function(id, value) value[1].content = 'b' return value end)`;
    expect(await run(computed, { kind: 'edit', stage: 'editRequest', value: request, meta: {} })).toMatchObject({ value: [{ role: 'user', content: 'b' }], handled: true });
  });
});

describe('block triggers', () => {
  it('run on their own event when their conditions pass, in one run with the Lua around them', async () => {
    const bonus = blocks('start', [{ type: 'setvar', operator: '+=', var: 'hp', value: '5' }], [{ type: 'var', var: 'hp', operator: '>=', value: '{{getvar::hp}}' }]);
    const seen: Trigger = { kind: 'lua', name: 'main', code: `function onStart(id) setChatVar(id, 'seen', getChatVar(id, 'hp')) end` };
    const refused = blocks('start', [{ type: 'setvar', operator: '=', var: 'hp', value: '0' }], [{ type: 'var', var: 'hp', operator: 'null' }]);
    const triggers = [bonus, seen, refused, blocks('output', [{ type: 'setvar', operator: '=', var: 'late', value: '1' }])];
    expect(await lua.run(String(owner++), triggers, SNAPSHOT, { kind: 'start' }, host())).toMatchObject({ errors: [], writes: [['hp', '15'], ['seen', '15']] });
  });

  it('take the branch of a v2 if that holds, reading operands as texts or as variable names', async () => {
    const branch = blocks('start', [
      { type: 'v2Header', indent: 0 },
      { type: 'v2IfAdvanced', condition: '>', source: 'hp', sourceType: 'var', target: '5', targetType: 'value', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'size', value: 'big', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1 },
      { type: 'v2Else', indent: 0 },
      { type: 'v2SetVar', operator: '=', var: 'size', value: 'small', valueType: 'value', indent: 1 },
      { type: 'v2EndIndent', indent: 1 },
      { type: 'v2SetVar', operator: '=', var: 'after', value: 'size', valueType: 'var', indent: 0 },
    ]);
    const at = async (hp: string) => (await lua.run(String(owner++), [branch], { ...SNAPSHOT, variables: [['hp', hp]] }, { kind: 'start' }, host())).writes;
    expect(await at('10')).toEqual([['size', 'big'], ['after', 'big']]);
    expect(await at('3')).toEqual([['size', 'small'], ['after', 'small']]);
  });

  it('write to the chat and stop the turn as Lua does', async () => {
    const outcome = await lua.run(String(owner++), [blocks('output', [
      { type: 'modifychat', index: '1', value: 'hp {{getvar::hp}}' },
      { type: 'impersonate', role: 'user', value: 'more' },
      { type: 'cutchat', start: '1', end: '3' },
      { type: 'stop' },
    ])], SNAPSHOT, { kind: 'output' }, host());
    expect(outcome).toMatchObject({ errors: [], stop: true, edits: [{ index: 1, text: 'hp 10' }], removed: [0], added: [{ role: 'user', text: 'more' }] });
  });

  it('name an effect this app lacks and go on', async () => {
    const outcome = await lua.run(String(owner++), [blocks('start', [{ type: 'v2RunLLM', indent: 0 }, { type: 'setvar', operator: '=', var: 'after', value: '1' }])], SNAPSHOT, { kind: 'start' }, host());
    expect(outcome).toMatchObject({ missing: ['v2RunLLM'], writes: [['after', '1']] });
  });
});
