import { LuaFactory, type LuaEngine } from 'wasmoon';
import type { Trigger } from '../import/types';
import { runBlocks } from './blocks';
import JSON_LUA from './json.lua?raw';
import PRELUDE from './prelude.lua?raw';
import { add, cbs, read, text, UNSET, working, write, type Acting, type Host, type ModelMessage, type Run, type Snapshot, type Working } from './state';

// One Lua trigger of a pack. name is for error messages only.
export type Script = Extract<Trigger, { kind: 'lua' }>;

export type EditStage = 'editInput' | 'editOutput' | 'editRequest';
export type Event =
  | { kind: 'input' | 'start' | 'output' }
  | { kind: 'button'; data: string }
  // A press on risu-trigger: each Lua script's own global function of that name, and each block trigger of that name
  // whatever its type, as Risu runs both.
  | { kind: 'call'; name: string }
  | { kind: 'edit'; stage: EditStage; value: unknown; meta: Record<string, unknown> };

export type ScriptError = { script: string; message: string };

// What a run did, for the caller to save. index is a message's place in the snapshot. value: an edit's result.
// handled: some script had the function the event calls, or a block trigger answered it. missing: the functions
// called and the block effects met that this app does not have.
export type Outcome = {
  value: unknown;
  stop: boolean;
  handled: boolean;
  writes: [string, string][];
  edits: { index: number; text: string }[];
  removed: number[];
  added: { role: 'user' | 'char'; text: string }[];
  reload: boolean;
  errors: ScriptError[];
  missing: string[];
};

// One message's editDisplay pass. variables: the writes since the item before it, over the snapshot's.
export type DisplayItem = { index: number; text: string; variables: [string, string][] };
// listening: false for a script whose engine holds no editDisplay listener, which has no part in any pass.
export type Displayed = { texts: string[]; listening: boolean[]; errors: ScriptError[]; missing: string[] };

const ENGINES = 8;
// Passed where Risu passes a run's access key. Bots hand it back as each call's first argument and never read it.
const KEY = 'lua';

const DEAF = Symbol('no listener');

const UNSUPPORTED = [
  'setChatRole', 'insertChat', 'similarity', 'request', 'generateImage', 'getCharacterImage', 'getCharacterImageMain',
  'getPersonaImage', 'getPersonaImageMain', 'setName', 'setDescription', 'setCharacterFirstMessage', 'getBackgroundEmbedding', 'setBackgroundEmbedding',
  'upsertLocalLoreBook',
];

type Engine = { lua: LuaEngine; own: Set<string>; run: Run | null; queue: Promise<unknown>; failed: string | null };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const roleOf = (value: unknown): Working['role'] => (value === 'user' ? 'user' : 'char');
const view = ({ role, data, time }: Working) => ({ role, data, time });

const MODEL_ROLES: Record<string, ModelMessage['role']> = { system: 'system', sys: 'system', user: 'user', assistant: 'assistant', bot: 'assistant', char: 'assistant' };

// The bot scripts' virtual machines. owner names whose Lua globals an engine holds (a chat), so two chats of one bot
// never share them; lane keeps the display's engines apart from the events', so a question an event waits on never
// holds up the display.
export class Lua {
  private readonly engines = new Map<string, Promise<Engine>>();

  private constructor(
    private readonly factory: LuaFactory,
    private readonly sliceMs: number,
  ) {}

  // wasm: where the browser loads the VM from; node finds its own. sliceMs: a stretch of a script that neither ends
  // nor yields within it is stopped with an error.
  static async create({ wasm, sliceMs = 5000 }: { wasm?: string; sliceMs?: number } = {}): Promise<Lua> {
    const factory = new LuaFactory(wasm);
    await factory.mountFile('json.lua', JSON_LUA);
    return new Lua(factory, sliceMs);
  }

  // The triggers in the packs' order, as Risu walks them: each Lua one called for the event, each block one run when
  // the event is its own.
  async run(owner: string, triggers: Trigger[], snapshot: Snapshot, event: Event, host: Host): Promise<Outcome> {
    const run: Acting = { quiet: false, snapshot, variables: new Map(snapshot.variables), globals: new Map(snapshot.globals), written: new Map(), messages: working(snapshot), host, stop: false, reload: false, missing: new Set() };
    const errors: ScriptError[] = [];
    let value = event.kind === 'edit' ? event.value : undefined;
    let handled = false;
    for (const script of triggers) {
      if (script.kind === 'blocks') {
        if (event.kind === 'call' ? script.name !== event.name : (event.kind !== 'start' && event.kind !== 'input' && event.kind !== 'output') || script.on !== event.kind) continue;
        handled = true;
        await runBlocks(script, run).catch((error: unknown) => errors.push({ script: script.name || script.on, message: describe(error) }));
        continue;
      }
      const engine = await this.engine(owner, 'event', script);
      await this.exclusive(engine, async () => {
        if (engine.failed !== null) return void errors.push({ script: script.name, message: engine.failed });
        engine.run = run;
        try {
          if (event.kind === 'edit') {
            const edited = await this.listeners(engine, event.stage, value, event.meta);
            if (edited === DEAF) return;
            value = edited ?? value;
            handled = true;
            return;
          }
          const name = event.kind === 'call' ? event.name : event.kind === 'button' ? 'onButtonClick' : `on${event.kind[0]!.toUpperCase()}${event.kind.slice(1)}`;
          if (event.kind === 'call' && !engine.own.has(name)) return;
          if (typeof engine.lua.global.get(name) !== 'function') return;
          handled = true;
          if ((await this.call(engine, name, KEY, ...(event.kind === 'button' ? [event.data] : []))) === false) run.stop = true;
        } catch (error) {
          errors.push({ script: script.name, message: describe(error) });
        } finally {
          engine.run = null;
        }
      });
    }
    const kept = run.messages.filter((message) => message.origin !== null);
    const origins = new Set(kept.map((message) => message.origin));
    return {
      value,
      stop: run.stop,
      handled,
      writes: [...run.written],
      edits: kept.filter((message) => message.data !== message.first).map((message) => ({ index: message.origin!, text: message.data })),
      removed: snapshot.messages.flatMap((_, index) => (origins.has(index) ? [] : [index])),
      added: run.messages.filter((message) => message.origin === null).map(({ role, data }) => ({ role, text: data })),
      reload: run.reload,
      errors,
      missing: [...run.missing],
    };
  }

  // Each item's text after every script's editDisplay listeners, in order; an item a script fails on keeps the text
  // it had.
  async display(owner: string, scripts: Script[], snapshot: Snapshot, items: DisplayItem[]): Promise<Displayed> {
    const errors: ScriptError[] = [];
    const missing = new Set<string>();
    const texts = items.map((item) => item.text);
    const globals = new Map(snapshot.globals);
    const messages = working(snapshot);
    const listening = scripts.map(() => true);
    for (const [place, script] of scripts.entries()) {
      const engine = await this.engine(owner, 'display', script);
      await this.exclusive(engine, async () => {
        if (engine.failed !== null) return void errors.push({ script: script.name, message: engine.failed });
        const variables = new Map(snapshot.variables);
        for (const [at, item] of items.entries()) {
          for (const [name, value] of item.variables) variables.set(name, value);
          engine.run = { quiet: true, snapshot, variables, globals, written: new Map(), messages, host: null, stop: false, reload: false, missing };
          try {
            const edited = await this.listeners(engine, 'editDisplay', texts[at], { index: item.index });
            if (edited === DEAF) return void (listening[place] = false);
            if (typeof edited === 'string') texts[at] = edited;
          } catch (error) {
            if (!errors.some((known) => known.script === script.name)) errors.push({ script: script.name, message: describe(error) });
          } finally {
            engine.run = null;
          }
        }
      });
    }
    return { texts, listening, errors, missing: [...missing] };
  }

  // Ends every engine, and with them their Lua globals. A run after it starts its engines anew.
  close() {
    for (const engine of this.engines.values()) end(engine);
    this.engines.clear();
  }

  // The value after the engine's listeners for the stage, or DEAF when it holds none.
  private async listeners(engine: Engine, stage: EditStage | 'editDisplay', value: unknown, meta: Record<string, unknown>): Promise<unknown> {
    const answer = await this.call(engine, 'callListenMain', stage, KEY, JSON.stringify(value), JSON.stringify(meta));
    return typeof answer === 'string' ? (JSON.parse(answer) as unknown) : DEAF;
  }

  private call(engine: Engine, name: string, ...args: unknown[]): Promise<unknown> {
    const called = engine.lua.global.get(name) as (...args: unknown[]) => unknown;
    return Promise.resolve(called(...args));
  }

  private exclusive(engine: Engine, task: () => Promise<void>): Promise<void> {
    const next = engine.queue.then(task);
    engine.queue = next.catch(() => {});
    return next;
  }

  private engine(owner: string, lane: 'event' | 'display', script: Script): Promise<Engine> {
    const key = `${owner}\n${lane}\n${script.code}`;
    let engine = this.engines.get(key);
    this.engines.delete(key);
    if (!engine) {
      engine = this.start(script);
      for (const [oldest, old] of this.engines) {
        if (this.engines.size < ENGINES) break;
        this.engines.delete(oldest);
        end(old);
      }
    }
    this.engines.set(key, engine);
    return engine;
  }

  private async start(script: Script): Promise<Engine> {
    // enableProxy off: an object handed to Lua becomes a table, never a live JS object a script could walk.
    const lua = await this.factory.createEngine({ injectObjects: true, enableProxy: false, functionTimeout: this.sliceMs });
    const engine: Engine = { lua, own: new Set(), run: null, queue: Promise.resolve(), failed: null };
    this.declare(engine);
    await lua.doString(PRELUDE);
    const before = new Set(globals(lua));
    try {
      const thread = lua.global.newThread();
      const index = lua.global.getTop();
      try {
        thread.loadString(script.code, `=${script.name}`);
        await thread.run(0, { timeout: this.sliceMs });
      } finally {
        lua.global.remove(index);
      }
    } catch (error) {
      engine.failed = describe(error);
    }
    engine.own = new Set(globals(lua).filter((name) => !before.has(name)));
    return engine;
  }

  private declare(engine: Engine) {
    const set = (name: string, api: (run: Run, ...args: never[]) => unknown) => engine.lua.global.set(name, (_key: unknown, ...args: never[]) => (engine.run ? api(engine.run, ...args) : undefined));
    // What a run does outside itself, which an editDisplay pass and a script outliving its run do not.
    const act = (name: string, api: (run: Acting, ...args: never[]) => unknown) => set(name, (run, ...args) => (run.quiet || !run.host ? undefined : api(run as Acting, ...args)));
    const last = (run: Run, role: Working['role']) => run.messages.findLast((message) => message.role === role)?.data;
    const model = (role: 'main' | 'aux') => (run: Acting, prompt: string) => {
      const messages = (JSON.parse(prompt) as { role?: unknown; content?: unknown }[]).map((message) => ({ role: MODEL_ROLES[text(message.role)] ?? 'assistant', content: text(message.content) }));
      return run.host.model(role, messages).then((answer) => JSON.stringify(answer));
    };

    set('getChatVar', (run, name: string) => read(run, name));
    set('setChatVar', (run, name: string, value: unknown) => void write(run, name, value));
    set('setChatVarChanged', (run, name: string, value: unknown) => (write(run, name, value) ? true : undefined));
    set('getGlobalVar', (run, name: string) => run.globals.get(name) ?? UNSET);

    set('getChatMain', (run, index: number) => JSON.stringify(run.messages.at(index) ? view(run.messages.at(index)!) : null));
    set('getChatData', (run, index: number) => run.messages.at(index)?.data ?? '');
    set('getChatRole', (run, index: number) => run.messages.at(index)?.role ?? '');
    set('getChatLength', (run) => run.messages.length);
    set('getFullChatMain', (run) => JSON.stringify(run.messages.map(view)));
    set('getRecentChatsMain', (run, count: number) => JSON.stringify(run.messages.slice(Math.max(0, run.messages.length - Math.max(0, Math.floor(count || 0)))).map(view)));
    set('getCharacterLastMessage', (run) => last(run, 'char') ?? run.snapshot.character.firstMessage);
    set('getUserLastMessage', (run) => last(run, 'user') ?? '');

    set('getName', (run) => run.snapshot.character.name);
    set('getDescription', (run) => run.snapshot.character.description);
    set('getCharacterFirstMessage', (run) => run.snapshot.character.firstMessage);
    set('getPersonaName', (run) => run.snapshot.persona.name);
    set('getPersonaDescription', (run) => run.snapshot.persona.description);
    set('getAuthorsNote', (run) => run.snapshot.note);

    act('setChat', (run, index: number, value: unknown) => {
      const message = run.messages.at(index);
      if (message) message.data = text(value);
    });
    act('removeChat', (run, index: number) => void run.messages.splice(index, 1));
    act('cutChat', (run, start: number, end: number) => void (run.messages = run.messages.slice(start, end)));
    act('addChat', (run, role: unknown, value: unknown) => add(run, roleOf(role), text(value)));

    // The messages given take the chat's place. One at the place of a message of its role is that message, edited;
    // any other is new, and a message no longer at its place is removed.
    act('setFullChatMain', (run, value: string) => {
      const given = (JSON.parse(value) as { role?: unknown; data?: unknown }[]).map((message) => ({ role: roleOf(message.role), data: text(message.data) }));
      const had = run.messages;
      run.messages = given.map(({ role, data }, index) => {
        const at = had[index];
        return at && at.origin !== null && at.role === role ? { ...at, data } : { origin: null, role, data, time: Date.now(), first: '' };
      });
    });

    // Risu's cbs takes no id before its text.
    engine.lua.global.set('cbs', (value: unknown) => (engine.run ? cbs(engine.run, text(value)) : undefined));
    // The entries of that name in the chat's lorebook, the modules' included, as Risu's own lore reads, each content
    // with its CBS evaluated.
    set('getLoreBooksMain', (run, search: unknown) =>
      JSON.stringify(
        run.snapshot.scope.lore
          .filter(({ value }) => value.name === text(search))
          .map(({ value }) => ({ key: value.keys.join(', '), secondkey: value.secondaryKeys.join(', '), comment: value.name, content: cbs(run, value.content), insertorder: value.insertionOrder, alwaysActive: value.constant, selective: value.selective, useRegex: value.useRegex, mode: 'normal' })),
      ),
    );
    act('loadLoreBooksMain', (run, reserve: unknown) =>
      run.host.lore(typeof reserve === 'number' ? reserve : null).then((entries) => JSON.stringify((entries ?? []).map(({ role, text: data }) => ({ data, role: role === 'assistant' ? 'char' : role })))),
    );

    act('stopChat', (run) => void (run.stop = true));
    act('alertNormal', (run, value: unknown) => run.host.say('normal', text(value)));
    act('alertError', (run, value: unknown) => run.host.say('error', text(value)));
    act('alertInput', (run, value: unknown) => run.host.ask({ kind: 'input', text: text(value) }).then((answer) => answer ?? ''));
    act('alertConfirm', (run, value: unknown) => run.host.ask({ kind: 'confirm', text: text(value) }).then((answer) => answer !== null));
    act('alertSelect', (run, options: unknown) => run.host.ask({ kind: 'select', options: Object.values((options ?? {}) as Record<string, unknown>).map(text) }).then((answer) => answer ?? ''));
    act('reloadDisplay', (run) => void (run.reload = true));
    act('reloadChat', (run) => void (run.reload = true));
    act('getTokens', (run, value: unknown) => run.host.tokens(text(value)));
    act('sleep', (_run, time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time)));
    act('LLMMain', model('main'));
    act('axLLMMain', model('aux'));

    set('hash', async (_run, value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text(value))))].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    engine.lua.global.set('logMain', () => {});
    for (const name of UNSUPPORTED) set(name, (run) => void run.missing.add(name));
  }
}

// Closed once what it is running has ended.
const end = (engine: Promise<Engine>) => void engine.then(({ lua, queue }) => queue.then(() => lua.global.close()));

function globals(lua: LuaEngine): string[] {
  const names: string[] = [];
  lua.global.set('__name', (name: unknown) => void (typeof name === 'string' && names.push(name)));
  lua.doStringSync('for name, value in pairs(_G) do if type(value) == "function" then __name(name) end end __name = nil');
  return names;
}
