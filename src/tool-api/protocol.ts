import type { Json, Settings, ToolManifest } from './manifest';

export type EventName = keyof Hazelle.Events;
export type ChatHeader = Pick<Hazelle.Chat, 'id' | 'character' | 'persona' | 'length'>;
export type Message = Hazelle.Message;
// value: the event's answer (prompt, replying, sending, requesting, showing). data: this chat's tool data
// (Hazelle.ChatData), undefined for a deletion. badges: by message index, null to clear.
export type ToolOutcome = {
  value?: Hazelle.PromptAnswer | Hazelle.RequestMessage[] | string[]; writes: [string, Json | undefined][]; edits: { index: number; text: string }[]; added: { role: 'user' | 'char'; text: string }[];
  data: [string, Json | undefined][]; badges: { index: number; text: string | null }[];
};
export type Method =
  | 'chat.messages' | 'chat.greeting' | 'chat.card' | 'chat.state.get' | 'chat.data.get' | 'chat.data.keys' | 'chat.lorebook' | 'chat.setup' | 'model' | 'embed' | 'fetch' | 'ask' | 'say' | 'tokens' | 'lore'
  | 'storage.get' | 'storage.set' | 'storage.delete' | 'storage.keys' | 'assets.save' | 'assets.read' | 'settings' | 'settings.set' | 'account' | 'post' | 'page.close' | 'frame.chat' | 'frame.show' | 'frame.hide' | 'frame.menu' | 'frame.missing';
export type Role = 'background' | 'page' | 'frame';
export type Down =
  | { kind: 'load'; api: 1; role: Role; code: string; manifest: ToolManifest; settings: Settings; chat: ChatHeader | null; theme: 'dark' | 'light' }
  | { kind: 'event'; id: number; event: EventName; chat: ChatHeader | null; reply?: Hazelle.At; turn?: Hazelle.Turn; change?: Hazelle.Change; from?: Hazelle.Branched; item?: string; message?: Hazelle.At; text?: string; messages?: Hazelle.RequestMessage[]; shown?: Hazelle.Shown[] }
  | { kind: 'answer'; call: number; ok: boolean; value: unknown }
  | { kind: 'storage'; keys: string[] }
  | { kind: 'message'; data: Json }
  | { kind: 'settings'; values: Settings }
  | { kind: 'open' }
  | { kind: 'ping' };
export type Up =
  | { kind: 'loaded'; listens: EventName[] }
  | { kind: 'load-failed'; message: string }
  | { kind: 'done'; id: number; outcome: ToolOutcome }
  | { kind: 'failed'; id: number; message: string }
  | { kind: 'call'; call: number; event?: number; method: Method; args: unknown[] }
  | { kind: 'cancel'; call: number }
  | { kind: 'pong' };

export type Port = Pick<MessagePort, 'onmessage' | 'postMessage' | 'start' | 'close'>;
