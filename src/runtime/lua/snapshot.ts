import type { Snapshot } from '../../engine/lua/state';
import type { ChatScope } from '../../engine/render';

// What Lua's own functions read of a chat besides its messages and variables; its CBS and lorebook reads go through
// the snapshot's scope. An editDisplay pass run on one is not fresh for another (ScriptDisplay).
export type LuaStanding = Pick<Snapshot, 'globals' | 'character' | 'persona' | 'note'>;

// The card without its scripts and triggers, which no tag reads and a run is handed apart.
function cbsScope({ card, persona, prompt, note, lore, messages, variables, greeting, model, clock, assets, modules, faces, screen, pick }: ChatScope): Snapshot['scope'] {
  return { card: card && { ...card, regex: [], triggers: [] }, persona, prompt, note, lore, messages, variables, greeting, model, clock, assets, modules, faces, screen, pick };
}

// The chat as Lua reads it: without its greeting, each message past its input or output stage (staged), with the
// variables given.
export function luaSnapshot(scope: ChatScope, standing: LuaStanding, staged: string[], variables: [string, string][]): Snapshot {
  const greeting = scope.greeting === null ? 0 : 1;
  return {
    messages: scope.messages.slice(greeting).map(({ role, time }, index) => ({ role: role === 'user' ? 'user' : 'char', data: staged[index + greeting]!, time: time ?? 0 })),
    variables,
    ...standing,
    scope: cbsScope(scope),
  };
}
