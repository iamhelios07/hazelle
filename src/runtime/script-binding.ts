import type { ScriptUnit } from '../engine/script-api';
import type { Lua } from '../engine/lua/run';
import type { Event, Host } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import type { ScriptOutcome } from './lua/event';

export type Binding<U, E extends Event = Event> = { run(chat: string, units: U, scope: ChatScope, event: E, host: Host, signal?: AbortSignal): Promise<ScriptOutcome>; close(): void };
export type LuaRunner = Binding<ScriptUnit[]> & Pick<Lua, 'installDisplay' | 'display' | 'forgetDisplay'>;

export class ToolStuck extends Error {
  constructor(message: string, readonly disabled = false) { super(message); }
}
export class ToolLate extends Error {}
export class ToolStopped extends Error {}
export const noOutcome = (): ScriptOutcome => ({ value: undefined, stop: false, handled: false, writes: [], edits: [], removed: [], added: [], reload: false, errors: [], missing: [] });
