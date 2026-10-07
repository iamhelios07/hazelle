import type { MemoryInput } from '../engine/memory';
import { shown, type Chat, type Message } from '../model/chat';
import { emptyMemory, memoryId, type Memory, type MemorySettings, type Source } from '../model/memory';
import { SETTINGS_ID } from '../model/settings';
import type { ObjectStore } from './store';

// budget, window and batch count tokens (model/memory MemorySettings).
export const MEMORY_DEFAULTS: MemorySettings = { on: true, budget: 25_000, window: 24_000, batch: 12_000 };

export type MemorySetup = MemorySettings & { own: boolean };

export const defaultMemory = (store: Pick<ObjectStore, 'get'>): MemorySettings => ({ ...MEMORY_DEFAULTS, ...store.get('settings', SETTINGS_ID)?.value.memory });

export const memorySetup = (store: Pick<ObjectStore, 'get'>, chat: Chat): MemorySetup => (chat.memory ? { ...chat.memory, own: true } : { ...defaultMemory(store), own: false });

export const chatMemory = (store: Pick<ObjectStore, 'children'>, chat: string): Memory => store.children('memory', chat).find((entry) => entry.id === memoryId(chat))?.value ?? emptyMemory();

export const sourcesOf = (messages: Message[]): Source[] => messages.map((message) => ({ message: message.id, version: shown(message).id }));

// null while memory is off.
export function memoryInput(store: Pick<ObjectStore, 'get' | 'children'>, id: string, chat: Chat, messages: Message[]): MemoryInput | null {
  const setup = memorySetup(store, chat);
  return setup.on ? { memory: chatMemory(store, id), budget: setup.budget, shown: sourcesOf(messages) } : null;
}
