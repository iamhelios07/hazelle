import type { Json, Settings, ToolManifest } from './manifest';

export type EventName = keyof Hazelle.Events;
export type ChatHeader = Pick<Hazelle.Chat, 'id' | 'character' | 'persona' | 'length'>;
export type Message = Hazelle.Message;
// data: this chat's tool data (Hazelle.ChatData), undefined for a deletion. badges: by message index, null to clear.
export type ToolOutcome = {
  value?: Hazelle.PromptAnswer; writes: [string, Json | undefined][]; edits: { index: number; text: string }[]; added: { role: 'user' | 'char'; text: string }[];
  data: [string, Json | undefined][]; badges: { index: number; text: string | null }[];
};
export type Method = 'chat.messages' | 'chat.greeting' | 'chat.state.get' | 'chat.data.get' | 'chat.data.keys' | 'model' | 'embed' | 'ask' | 'say' | 'tokens' | 'lore' | 'storage.get' | 'storage.set' | 'storage.delete' | 'storage.keys' | 'settings' | 'post' | 'page.close';
export type Down =
  | { kind: 'load'; api: 1; role: 'background' | 'page'; code: string; manifest: ToolManifest; settings: Settings; chat: ChatHeader | null; theme: 'dark' | 'light' }
  | { kind: 'event'; id: number; event: EventName; chat: ChatHeader | null; reply?: Hazelle.At; turn?: Hazelle.Turn; change?: Hazelle.Change; from?: Hazelle.Branched; item?: string; message?: Hazelle.At }
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

export type Port = Pick<MessagePort, 'onmessage' | 'postMessage' | 'start' | 'close'>;
