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
  toggles: string;
  utility: boolean;
  bias: [string, number][];
  regex: RegexScript[];
  // The card's backgroundHTML, absent when it has none. Only its <style> blocks are shown (design §6.4).
  background?: string;
  // Each setting stands alone, as in CCv3; null leaves it to the global default.
  loreSettings: { scanDepth: number | null; tokenBudget: number | null; recursive: boolean | null; fullWordMatching: boolean | null };
};

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
  assets: { name: string; read: () => Uint8Array<ArrayBuffer> | null }[];
  report: ImportReport;
};

export const UNSUPPORTED_KINDS = [
  'trigger',
  'lua',
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

export type ImportFailure = { kind: 'unknown-format' | 'module-file' | 'encrypted' | 'unreadable'; detail?: string };

export type ImportResult = { ok: true; card: Imported } | { ok: false; failure: ImportFailure };
