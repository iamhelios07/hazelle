import type { Json, Settings, ToolManifest } from './manifest';

export type EventName = 'reply' | 'prompt' | 'menu' | 'settings' | 'message';
export type ChatHeader = { id: string; character: { name: string; description: string } | null; persona: { name: string; description: string }; length: number };
export type Message = { index: number; id: string; role: 'user' | 'char'; text: string; time: number };
export type ToolOutcome = { value?: string | null; writes: [string, Json | undefined][]; edits: { index: number; text: string }[]; added: { role: 'user' | 'char'; text: string }[] };
export type Method = 'chat.messages' | 'chat.state.get' | 'model' | 'ask' | 'say' | 'tokens' | 'lore' | 'storage.get' | 'storage.set' | 'storage.delete' | 'storage.keys' | 'settings' | 'post' | 'page.close';
export type Down =
  | { kind: 'load'; api: 1; role: 'background' | 'page'; code: string; manifest: ToolManifest; settings: Settings; chat: ChatHeader | null; theme: 'dark' | 'light' }
  | { kind: 'event'; id: number; event: EventName; chat: ChatHeader | null; reply?: { index: number; id: string }; item?: string }
  | { kind: 'answer'; call: number; ok: boolean; value: unknown }
  | { kind: 'storage'; keys: string[] }
  | { kind: 'message'; data: Json }
  | { kind: 'settings'; values: Settings }
  | { kind: 'ping' };
export type Up =
  | { kind: 'loaded'; listens: EventName[] }
  | { kind: 'load-failed'; message: string }
  | { kind: 'done'; id: number; outcome: ToolOutcome }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'call'; call: number; event?: number; method: Method; args: unknown[] }
  | { kind: 'pong' };
