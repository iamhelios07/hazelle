import type { Chat } from '../../model/chat';
import type { ToolManifest } from '../../tool-api/manifest';
import type { EventName } from '../../tool-api/protocol';

export type ToolMenu = { module: string; manifest: ToolManifest };
export type ToolPage = { window: Window; chat: string | null; theme: 'dark' | 'light'; close: () => void };
export type MenuItem = { id: string; label: string };
// Where a frame tool's document is shown (a tool page or a chat's tool panel): place puts the frame over it, null
// takes it away; close ends the page around it.
export type ToolSlot = { chat: string | null; place(frame: HTMLIFrameElement | null): void; close(): void };
// Each running frame tool: its ⋯ items, its message actions, the chat it runs for, and whether it asks to be shown with
// no slot to show it.
export type ToolFrames = ReadonlyMap<string, { menu: MenuItem[]; actions: MenuItem[]; chat: string | null; asking: boolean }>;
// By module, the hosts its tool's fetches went to in this page session and how many times; nothing they sent is kept.
export type ToolHosts = ReadonlyMap<string, ReadonlyMap<string, number>>;
export type Tools = {
  warm(chat: string): Promise<void>;
  menus(chat: string): ToolMenu[];
  // A new chat's, from its settings before its first save.
  menusOf(chat: Chat): ToolMenu[];
  // Runs a new chat's tools before its first save, until the call it answers; its presses save it first (useChat).
  draft(chat: string, value: Chat): () => void;
  // A tool's ⋯ items: its header's, or for a frame tool what its frame registered while it runs.
  items(module: string): MenuItem[];
  // Its items in a message's ⋯, from the same source as items.
  actions(module: string): MenuItem[];
  // Whether the module's running tool listens for event; null until it has loaded.
  hears(module: string, event: EventName): boolean | null;
  page(module: string, page: ToolPage): () => void;
  attach(module: string, slot: ToolSlot): () => void;
  subscribe(listener: () => void): () => void;
  frames(): ToolFrames;
  hosts(): ToolHosts;
};
