import type { Trigger } from '../engine/import/types';
import type { Lua } from '../engine/lua/run';
import type { Event, Host } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import type { ScriptOutcome } from './lua/event';

export type Binding<U> = { run(chat: string, units: U[], scope: ChatScope, event: Event, host: Host): Promise<ScriptOutcome>; close(): void };
export type LuaRunner = Binding<Trigger> & Pick<Lua, 'installDisplay' | 'display' | 'forgetDisplay'>;
