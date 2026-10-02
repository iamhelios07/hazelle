import type { PresetResult } from './preset';

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

// What works on a chat's text without being the character: a character's card holds one as its own, and a module is
// one with a name (design §6.5). Its lorebook and assets are stored objects of their own, under whichever holds it.
// A chat reads its packs as one list (runtime/turn packsOf), never a card's or a module's apart.
export type Pack = {
  regex: RegexScript[];
  // The triggers that do something, in Risu's order, which is the order a run walks them in (runtime/scripts).
  triggers: Trigger[];
  // Risu's backgroundHTML, absent when there is none. Only its <style> blocks are shown (design §6.4).
  background?: string;
  toggles: string;
};

// name is Risu's comment. Risu runs a Lua trigger at every event, whatever its trigger type, so a Lua one keeps no
// `on`. A block trigger keeps Risu's type, conditions and effects verbatim, like a regex's source: engine/lua/blocks
// reads them as it runs, so an effect it learns to run later needs no new import.
export type Trigger = { kind: 'lua'; name: string; code: string } | { kind: 'blocks'; name: string; on: string; conditions: unknown[]; effects: unknown[] };

// flags: the custom flag string, <…> meta blocks included; null runs the default `g`.
export type RegexScript = { name: string; find: string; replace: string; stage: 'input' | 'output' | 'process' | 'display'; flags: string | null };

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
] as const;
export type UnsupportedKind = (typeof UNSUPPORTED_KINDS)[number];

export type ImportReport = {
  format: 'png' | 'charx' | 'json';
  spec: 'v1' | 'v2' | 'v3';
  unsupported: { kind: UnsupportedKind; count: number }[];
};

export type ImportFailure = { kind: 'unknown-format' | 'encrypted' | 'unreadable'; detail?: string };

// A Risu module, read (design §6.5): its pack, with its lorebook and pictures beside it as a card's are.
export type ImportedModule = {
  name: string;
  description: string;
  namespace: string | null;
  // Risu's id for it, which a Risu backup's characters and settings name it by.
  risu: string | null;
  pack: Pack;
  lore: LoreEntry[];
  loreFolders: string[];
  assets: Imported['assets'];
  unsupported: ImportReport['unsupported'];
};

// A file holds a character or a module.
export type ImportResult = { ok: true; card: Imported } | { ok: true; module: ImportedModule } | { ok: false; failure: ImportFailure };

// A Risu local backup, read (design F7; research/risu-backup-spec.md). Pictures stay in the file until a character
// or persona is brought.
export type BackupSource = { size: number; read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> };
export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };

// Text as Risu stored it, already past the bot's input and output scripts.
export type RisuMessage = { role: 'user' | 'assistant'; text: string; at: number };
export type RisuChat = {
  title: string;
  // 작가의 노트; null when Risu's is empty.
  note: string | null;
  // The Risu persona id the chat is bound to.
  persona: string | null;
  // Index into the card's greetings.
  greeting: number;
  // Risu's chat variables (scriptstate without its `$`), Lua's state included.
  variables: [string, string][];
  messages: RisuMessage[];
};
export const MOVE_UNSUPPORTED_KINDS = [
  'group-chat',
  'chat-lore',
  'memory',
  'inlay',
  'module',
  'chat-folder',
  'bookmark',
  'hidden-message',
  'cold-missing',
  'missing-picture',
] as const;
export type MoveUnsupportedKind = (typeof MOVE_UNSUPPORTED_KINDS)[number];
export type MoveUnsupported = { kind: MoveUnsupportedKind; count: number };

// The card as the card importer reads it, with its pictures read from the backup when it is brought.
export type RisuCharacter = Omit<Imported, 'avatar'> & {
  // Risu's chaId.
  id: string;
  avatar: () => Promise<Picture | null>;
  // The Risu folder it sits in, by name.
  folder: string | null;
  chats: RisuChat[];
  // What its chats held that does not come.
  missed: MoveUnsupported[];
};
export type RisuPersona = { id: string | null; name: string; description: string; picture: () => Promise<Picture | null> };
export type RisuPreset = { name: string; result: PresetResult };
export type RisuBackup = {
  characters: RisuCharacter[];
  personas: RisuPersona[];
  presets: RisuPreset[];
  // What the backup held outside its characters that does not come (group chats, modules).
  unsupported: MoveUnsupported[];
};
export type BackupFailure = { kind: 'encrypted' | 'no-database' | 'unreadable'; detail?: string };
export type BackupResult = { ok: true; backup: RisuBackup } | { ok: false; failure: BackupFailure };
