import type { ChatScope } from '../engine/render';
import type { ScriptUnit } from '../engine/script-api';
import { live } from '../model/library';
import type { ToolUnit } from '../model/tool';
import { packsOf, scopeOf } from './chat-context';
import type { ReadModels } from './read-model';
import type { ObjectStore } from './store';
import { toolsOf } from './tools/store';

// The triggers of a chat's packs, in the packs' order (design §6.5), which is the order a run walks them in. A block
// trigger keeps its name as written, since a press finds it by that. One turned off, and a Lua one with no code yet,
// are left out: it would start an engine and count the chat as scripted for nothing.
export const triggersOf = (packs: ReturnType<typeof packsOf>): ScriptUnit[] => packs.flatMap(({ id, pack, module }) =>
  pack.triggers.filter((trigger) => !trigger.off && (trigger.kind !== 'lua' || trigger.code.trim())).map((trigger) => ({
    ...trigger, ...(trigger.kind === 'lua' && { name: trigger.name || 'Lua' }), owner: { kind: module ? 'module' as const : 'character' as const, id },
  })),
);
// index counts from the first message after the greeting, as a tool reads it.
export const atOf = (scope: ChatScope, message: string): Hazelle.At | null => {
  const index = scope.messages.findIndex((each) => each.message === message);
  return index === -1 ? null : { index: index - (scope.greeting === null ? 0 : 1), id: message, version: scope.messages[index]!.id };
};

export const scriptsOf = (packs: ReturnType<typeof packsOf>) => triggersOf(packs).filter((trigger): trigger is Extract<ScriptUnit, { kind: 'lua' }> => trigger.kind === 'lua');

export function unitFor(store: ObjectStore, chat: string, module: string): ToolUnit | null {
  const stored = live(store.get('chat', chat));
  return (stored && toolsOf(store, stored.value).find((unit) => unit.module === module)) ?? null;
}

export function scopeFor(session: { store: ObjectStore; read: ReadModels }, chat: string): ChatScope {
  return scopeOf(session, chat, session.store.get('chat', chat)!.value, session.store.foldedChat(chat).messages);
}
