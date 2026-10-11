import type { ImportedTool } from '../../engine/import/tool';
import type { BackupCatalog, BackupFailure, Imported, ImportedModule, ImportFailure, MoveUnsupported, Picture, RisuCharacter, RisuChat, RisuMessage, RisuPersona, RisuPreset } from '../../engine/import/types';
import type { ChatFile } from '../chat-file';

export type AssetRead = { name: string; handle: number };
export type CardData = Omit<Imported, 'avatar' | 'assets'> & { avatar: number | null; assets: AssetRead[] };
export type ModuleData = Omit<ImportedModule, 'assets'> & { assets: AssetRead[] };
export type CharacterData = Omit<RisuCharacter, 'avatar' | 'assets' | 'chats'> & { avatar: number; assets: AssetRead[]; chatCount: number };
export type PersonaData = Omit<RisuPersona, 'picture' | 'module'> & { picture: number; module: ModuleData | null };
// A file of chats, which a JSON card file may be instead: this app's own, or Risu's.
export type ChatsRead = { ok: true; chat: ChatFile } | { ok: true; risuChats: RisuChat[]; missed: MoveUnsupported[] };

type Inputs = {
  backup: { files: File[] };
  card: { file: File };
  character: { key: number };
  persona: { key: number };
  preset: { key: number };
  module: { key: number };
  chat: { index: number };
  messages: { index: number; from: number };
  release: object;
  asset: { handle: number };
  picture: { handle: number };
};
export type Replies = {
  backup: { ok: true; catalog: BackupCatalog } | { ok: false; failure: BackupFailure };
  card: { ok: true; tool: ImportedTool } | { ok: true; card: CardData } | { ok: true; module: ModuleData } | ChatsRead | { ok: false; failure: ImportFailure };
  character: CharacterData;
  persona: PersonaData;
  preset: RisuPreset;
  module: ModuleData;
  chat: { header: Omit<RisuChat, 'messages'>; messages: number };
  messages: { messages: RisuMessage[]; next: number };
  release: null;
  asset: Uint8Array<ArrayBuffer> | null;
  picture: Picture | null;
};
export type Method = keyof Inputs;
export type Request<K extends Method = Method> = { [M in K]: { kind: M } & Inputs[M] }[K];
export type Down<K extends Method = Method> = { id: number; request: Request<K> };
export type Up = { id: number; result: Replies[Method] } | { id: number; error: string };

export const MESSAGE_PAGE = 256;
export const MESSAGE_BYTES = 1_000_000;
export class ImportReadError extends Error {}
