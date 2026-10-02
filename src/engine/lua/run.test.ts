import { describe, expect, it } from 'vitest';
import { Lua, type Event, type Host, type Snapshot } from './run';

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
};

const host = (over: Partial<Host> = {}): Host & { said: string[] } => {
  const said: string[] = [];
  return { said, say: (kind, text) => void said.push(`${kind}:${text}`), ask: async () => null, model: async () => ({ success: true, result: 'made' }), tokens: async (text) => text.length, ...over };
};

const lua = await Lua.create({ sliceMs: 300 });
let owner = 0;
const run = (code: string, event: Event, over: Partial<Host> = {}, snapshot = SNAPSHOT) => lua.run(String(owner++), [{ name: 'main', code }], snapshot, event, host(over));

describe('Lua runs', () => {
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

  it('reports an error with its line, a function this app lacks, and a script that never ends', async () => {
    const failed = await run(`function onStart(id)\n  local none = nil\n  return none.field\nend`, { kind: 'start' });
    expect(failed.errors[0]!.message).toContain('main:3:');
    expect((await run(`function onStart(id) generateImage(id, 'x') setChatVar(id, 'after', '1') end`, { kind: 'start' }))).toMatchObject({ missing: ['generateImage'], writes: [['after', '1']] });
    expect((await run(`syntax error here`, { kind: 'start' })).errors).toHaveLength(1);
    expect((await run(`function onStart(id) while true do end end`, { kind: 'start' })).errors[0]!.message).toContain('timeout');
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
    const shown = await lua.display('display', [{ name: 'main', code }], SNAPSHOT, [
      { index: 0, text: 'a', variables: [] },
      { index: 1, text: 'b', variables: [['hp', '4']] },
    ]);
    expect(shown).toEqual({ texts: ['a:0:10:hello', 'b:1:4:hello'], errors: [], missing: [] });
  });
});
