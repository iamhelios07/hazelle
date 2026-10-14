import type { PresetFailure, PresetResult } from './preset';
import type { BlockCondition, BlockEffect } from './blocks';
import type { Character } from '../../model/library';
import type { Likeness } from '../../model/likeness';

export type Card = {
  name: string;
  nickname: string | null;
  description: string;
  personality: string;
  scenario: string;
  // first_mes, then alternate_greetings, at their positions: index i is the greeting `@@is_greeting i+1`
  // and `{{firstmsgindex}}` point at, so an empty greeting is kept rather than shifting the ones after it.
  greetings: string[];
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  version: string;
  tags: string[];
  variables: [string, string][];
  utility: boolean;
  bias: [string, number][];
  // Each setting stands alone, as in CCv3; null leaves it to the global default.
  loreSettings: { scanDepth: number | null; tokenBudget: number | null; recursive: boolean | null; fullWordMatching: boolean | null };
} & Pack;

// Its lorebook and assets are stored objects of their own, under whichever holds it. A chat reads its packs as one list
// (runtime/turn packsOf), never a card's or a module's apart.
export type Pack = {
  regex: RegexScript[];
  // The triggers that do something, in Risu's order, which is the order a run walks them in (runtime/scripts).
  triggers: Trigger[];
  // Risu's backgroundHTML, absent when there is none. Only its <style> blocks are shown (design §6.4).
  background?: string;
  toggles: string;
};

// id: opaque, and unique within its pack only (import/convert stampIds). off keeps a script in its place but stops it.
export type Listed = { id: string; off?: true };

// name is Risu's comment. Risu runs a Lua trigger at every event, whatever its trigger type, so a Lua one keeps no
// `on`. A block trigger is normalized at import; unsupported conditions/effects retain opaque source data so future
// support can read it without a new import. Execution consumes only the canonical operations.
export type Trigger = Listed & ({ kind: 'lua'; name: string; code: string } | { kind: 'blocks'; name: string; on: string; conditions: BlockCondition[]; effects: BlockEffect[] });

// flags: the custom flag string, <…> meta blocks included; null runs the default `g`.
export type RegexScript = Listed & { name: string; find: string; replace: string; stage: 'input' | 'output' | 'process' | 'display'; flags: string | null };

export type LoreEntry = {
  name: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  useRegex: boolean;
  caseSensitive: boolean;
  insertionOrder: number;
  priority: number | null;
  position: 'before_char' | 'after_char' | null;
  // Index into Imported.loreFolders. Folders only group entries on screen; they never change activation.
  folder: number | null;
};

export type Imported = {
  card: Card;
  lore: LoreEntry[];
  loreFolders: string[];
  avatar: { bytes: Uint8Array<ArrayBuffer>; type: string } | null;
  // The bot's own pictures, read one at a time when they are stored; read answers null for one the file lacks.
  assets: { name: string; read: () => Promise<Uint8Array<ArrayBuffer> | null> }[];
  report: ImportReport;
  // What a Hazelle charx carries beyond Risu's fields (engine/import/hazelle); null for any other file.
  own: HazelleOwn | null;
  // The modules a Hazelle charx was exported with, on for the character.
  bundled: BundledModule[];
};

// What of a character, beyond its card, a Hazelle export carries. Translations go without their receipts, which are
// the exporting account's usage, and so do 삽화 profiles.
export type CharacterOwn = Pick<Character, 'translatorNote' | 'keepThoughts' | 'statusScripts' | 'translations'>;
export type Profiles = Omit<Likeness, 'receipt'>;
export type HazelleOwn = { character: CharacterOwn; likeness: Profiles | null };
export type BundledModule = ImportedModule & { likeness: Profiles | null };

// A character as the charx writer takes it (engine/import/card writeCharx): pictures by their type, the bytes fetched
// later in the same order.
type Typed = { name: string; type: string };
export type Bot = {
  card: Card;
  lore: LoreEntry[];
  loreFolders: string[];
  avatar: string | null;
  assets: Typed[];
  own: HazelleOwn;
  bundled: (Omit<BundledModule, 'assets' | 'unsupported'> & { assets: Typed[] })[];
};

export const UNSUPPORTED_KINDS = [
  'asset',
  'background-html',
  'additional-text',
  'prebuilt-asset-command',
  'depth-prompt',
  'disable-ui-prompt',
  'cbs-tag',
  'regex-stage',
  'module',
  'toggle-line',
  'mcp',
  'cjs',
  'hazelle',
] as const;
export type UnsupportedKind = (typeof UNSUPPORTED_KINDS)[number];

export type ImportReport = {
  format: 'png' | 'charx' | 'json';
  spec: 'v1' | 'v2' | 'v3';
  unsupported: { kind: UnsupportedKind; count: number }[];
};

// line: the declaration a tool file was refused for, as written.
export type ImportFailure = { kind: 'unknown-format' | 'encrypted' | 'unreadable'; detail?: string; line?: string };

export type ImportedModule = {
  name: string;
  description: string;
  namespace: string | null;
  // The id a module file names it by, which a Risu backup's characters and settings name it by too: Risu's, or for one
  // made in this app, its id in the account that exported it with a character.
  risu: string | null;
  pack: Pack;
  lore: LoreEntry[];
  loreFolders: string[];
  assets: Imported['assets'];
  unsupported: ImportReport['unsupported'];
};

export type ImportResult = { ok: true; card: Imported } | { ok: true; module: ImportedModule } | { ok: false; failure: ImportFailure };

// A Risu local backup, read (design F7; research/risu-backup-spec.md). Pictures stay in the file until a character,
// persona or module is brought.
export type BackupSource = { size: number; read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> };
export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };

// Text as Risu stored it, already past the bot's input and output scripts.
// reasoning: what Risu kept inside the text as <Thoughts> blocks, taken out of it. bookmark: Risu's on the message, with
// its name if it had one.
export type RisuMessage = { role: 'user' | 'assistant'; text: string; at: number; reasoning?: string; bookmark?: { name?: string } };
export type RisuChat = {
  title: string;
  // 작가의 노트; null when Risu's is empty.
  note: string | null;
  persona: string | null;
  // Index into the card's greetings, which may lie past them: the card is known only where the chat is written.
  greeting: number;
  // Risu's chat variables (scriptstate without its `$`), Lua's state included.
  variables: [string, string][];
  // The ids of Risu's inlay items its messages name (engine/import/risu-character inlayIds).
  inlays: string[];
  messages: RisuMessage[];
};
export const MOVE_UNSUPPORTED_KINDS = [
  'group-chat',
  'chat-lore',
  'memory',
  'inlay',
  'chat-folder',
  'hidden-message',
  'cold-missing',
  'missing-picture',
] as const;
export type MoveUnsupportedKind = (typeof MOVE_UNSUPPORTED_KINDS)[number];
export type MoveUnsupported = { kind: MoveUnsupportedKind; count: number };

export type RisuCharacter = Omit<Imported, 'avatar' | 'own' | 'bundled'> & {
  // Risu's chaId.
  id: string;
  avatar: () => Promise<Picture | null>;
  // The Risu folder it sits in, by name.
  folder: string | null;
  chats: RisuChat[];
  // The Risu ids of the modules on for it, whether or not the backup holds them.
  modules: string[];
  missed: MoveUnsupported[];
};
// alias: Risu's persona note, a line only the user reads to tell personas of one name apart, which is what a 별명 is.
// module: its embedded module, which Risu names after the persona.
export type RisuPersona = { id: string | null; name: string; alias: string; description: string; picture: () => Promise<Picture | null>; module: ImportedModule | null };
export type RisuPreset = { name: string; result: PresetResult };
// pictures: the picture entries the files hold, in all; 0 says the account backup was written without its assets.
// pictureBytes: their size together. inlayCount: the inlay items a character's chats name, each chat's counted apart,
// as each chat holds its own.
export type BackupCatalog = {
  pictures: number;
  pictureBytes: number;
  characters: { key: number; id: string; name: string; chatCount: number; assetCount: number; inlayCount: number; lastTalk: number }[];
  personas: { key: number; name: string; alias: string }[];
  presets: { key: number; name: string; failure: PresetFailure['kind'] | null }[];
  modules: { key: number; name: string; risu: string | null; assetCount: number }[];
  // The Risu ids of the modules on in every chat, whether or not the backup holds them.
  alwaysModules: string[];
  unsupported: MoveUnsupported[];
};
// Catalog rows carry no history or asset readers. Keys identify source positions even when Risu ids repeat.
export type RisuBackup = {
  catalog: BackupCatalog;
  character(key: number): Promise<RisuCharacter>;
  persona(key: number): Promise<RisuPersona>;
  preset(key: number): Promise<RisuPreset>;
  module(key: number): Promise<ImportedModule>;
};
export type BackupFailure = { kind: 'encrypted' | 'no-database' | 'unreadable'; detail?: string };
export type BackupResult = { ok: true; backup: RisuBackup } | { ok: false; failure: BackupFailure };
