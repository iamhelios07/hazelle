import type { MemoryFill } from '../engine/pipeline';
import { shown, type Chat, type Message } from '../model/chat';
import { emptyMemory, memoryId, type Memory, type MemorySettings, type Source } from '../model/memory';
import { SETTINGS_ID } from '../model/settings';
import type { ToolUnit } from '../model/tool';
import type { ObjectStore } from './store';
import { toolsOf } from './tools/store';

// budget, window and batch count tokens (model/memory MemorySettings).
export const MEMORY_DEFAULTS: MemorySettings = { on: true, budget: 25_000, window: 24_000, batch: 12_000 };

export type MemorySetup = MemorySettings & { own: boolean };

export const defaultMemory = (store: Pick<ObjectStore, 'get'>): MemorySettings => ({ ...MEMORY_DEFAULTS, ...store.get('settings', SETTINGS_ID)?.value.memory });

export const memorySetup = (store: Pick<ObjectStore, 'get'>, chat: Chat): MemorySetup => (chat.memory ? { ...chat.memory, own: true } : { ...defaultMemory(store), own: false });

export const chatMemory = (store: Pick<ObjectStore, 'children'>, chat: string): Memory => store.children('memory', chat).find((entry) => entry.id === memoryId(chat))?.value ?? emptyMemory();

export const sourcesOf = (messages: Message[]): Source[] => messages.map((message) => ({ message: message.id, version: shown(message).id }));

// Who fills the chat's memory slot (design §6.10): the first tool in pack order whose module the user let take it, else
// the built-in memory while it is on; null while memory is off. A claim not answered yet leaves the built-in memory on.
export type MemoryOwner = { kind: 'built-in'; setup: MemorySetup } | { kind: 'tool'; unit: ToolUnit } | null;

export function memoryOwner(store: ObjectStore, chat: Chat): MemoryOwner {
  const unit = toolsOf(store, chat).find(({ module, tool }) => tool.manifest.uses.includes('memory') && store.get('module', module)?.value.takesMemory === true);
  if (unit) return { kind: 'tool', unit };
  const setup = memorySetup(store, chat);
  return setup.on ? { kind: 'built-in', setup } : null;
}

// The slot as a turn is gathered. A tool's text comes with the turn's prompt event (runtime/scripts prompting); until
// then it stands for no message.
export function memoryFill(store: ObjectStore, id: string, chat: Chat, messages: Message[]): MemoryFill | null {
  const owner = memoryOwner(store, chat);
  if (owner?.kind === 'tool') return { kind: 'tool', name: owner.unit.tool.manifest.displayName, text: '', through: -1 };
  return owner && { kind: 'built-in', memory: chatMemory(store, id), budget: owner.setup.budget, shown: sourcesOf(messages) };
}
