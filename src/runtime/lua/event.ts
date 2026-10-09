import type { ScriptUnit } from '../../engine/script-api';
import type { Lua } from '../../engine/lua/run';
import type { Event, Outcome } from '../../engine/script-api';
import type { Host } from '../../engine/script-api';
import { renderChat, type ChatScope } from '../../engine/render';
import { luaSnapshot, luaStanding } from './snapshot';

export type ScriptOutcome = Omit<Outcome, 'edits'> & { edits: (Outcome['edits'][number] & { wrote: [string, string][] })[] };

export async function runEvent(machine: Lua, owner: string, triggers: ScriptUnit[], scope: ChatScope, event: Event, host: Host): Promise<ScriptOutcome> {
  const { staged, wrote, variables } = renderChat('prompt', scope);
  const snapshot = luaSnapshot(scope, luaStanding(scope), staged, [...variables]);
  const outcome = await machine.run(owner, triggers, snapshot, event, host);
  const greeting = scope.greeting === null ? 0 : 1;
  return { ...outcome, edits: outcome.edits.map(edit => ({ ...edit, wrote: wrote[edit.index + greeting]! })) };
}
