import { count, isRecord, list } from '../../connectors/values';
import { parseDecorators } from '../lorebook/decorators';
import type { Card, ImportReport, LoreEntry, RegexScript, UnsupportedKind } from './types';

type Json = Record<string, unknown>;
type Entry = Omit<LoreEntry, 'name' | 'folder'>;

export type Tally = Map<UnsupportedKind, number>;

export function add(tally: Tally, kind: UnsupportedKind, amount = 1) {
  tally.set(kind, (tally.get(kind) ?? 0) + amount);
}

export type Converted = {
  card: Card;
  lore: LoreEntry[];
  loreFolders: string[];
  spec: ImportReport['spec'];
  // The uri of the card's icon asset, when it names one.
  icon: string | null;
};

const SPECS = new Map<unknown, ImportReport['spec']>([
  ['chara_card_v2', 'v2'],
  ['chara_card_v3', 'v3'],
]);
const STAGES = new Map<unknown, RegexScript['stage']>([
  ['editinput', 'input'],
  ['editoutput', 'output'],
  ['editprocess', 'process'],
  ['editdisplay', 'display'],
]);
const ROLES = ['system', 'user', 'assistant'];
// Risu's order for a new entry. CCv3 requires insertion_order, so only a malformed file goes without one.
const DEFAULT_ORDER = 100;

// CBS tags the spec marks X (risu-compat-spec §d), with their aliases in src/ts/cbs.ts at ca1345fc, spelled as
// Risu's matcher compares names: lowercased, without whitespace, '_' or '-'. The internal-only `__` is left out,
// since that spelling makes its name empty.
const UNSUPPORTED_TAGS = new Set([
  'button',
  'triggerid',
  'emotionlist',
  'assetlist',
  'chardisplayasset',
  'moduleenabled',
  'moduleassetlist',
  'file',
  'risu',
  'bkspc',
  'erase',
  'xor',
  'xorencrypt',
  'xorencode',
  'xore',
  'xordecrypt',
  'xordecode',
  'xord',
  'crypt',
  'crypto',
  'caesar',
  'encrypt',
  'decrypt',
  'raw',
  'path',
  'img',
  'image',
  'video',
  'audio',
  'bgm',
  'bg',
  'emotion',
  'asset',
  'videoimg',
  'source',
  'inlay',
  'inlayed',
  'inlayeddata',
  'assetprompt',
]);

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
const record = (value: unknown): Json => (isRecord(value) ? value : {});
const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === 'string');
// CCv3 key arrays stay intact; only blank keys are dropped.
const keys = (value: unknown) => strings(value).filter((key) => key.trim() !== '');
// Risu's own lore joins keys into one string, split here as Risu splits it.
const split = (value: unknown) =>
  text(value)
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
const order = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_ORDER);

// module: a charx's module.risum. Its regex and triggers replace the card's, and its lorebook, when it has one,
// replaces the character_book entries; lore settings stay the card's (characterCards.ts:148-158 at ca1345fc).
export function convert(raw: unknown, module: Json | null, tally: Tally): Converted | null {
  if (!isRecord(raw)) return null;
  const spec = SPECS.get(raw.spec) ?? 'v1';
  const data = spec === 'v1' ? tavern(raw) : isRecord(raw.data) ? raw.data : null;
  if (!data) return null;
  const extensions = record(data.extensions);
  const risu = record(extensions.risuai);
  const book = record(data.character_book);

  const assets = spec === 'v3' ? list(data.assets) : [];
  const icon = pickIcon(assets);
  add(tally, 'asset', assets.length - (icon ? 1 : 0));
  if (spec === 'v2') add(tally, 'asset', list(risu.emotions).length + list(risu.additionalAssets).length + Object.keys(record(risu.vits)).length);
  for (const trigger of module ? list(module.trigger) : list(risu.triggerscript)) add(tally, isLua(trigger) ? 'lua' : 'trigger');
  if (text(risu.backgroundHTML).trim()) add(tally, 'background-html');
  if (text(risu.additionalText).trim()) add(tally, 'additional-text');
  if (risu.prebuiltAssetCommand === true) add(tally, 'prebuilt-asset-command');
  if (text(record(extensions.depth_prompt).prompt).trim()) add(tally, 'depth-prompt');

  const greetings = [data.first_mes, ...list(data.alternate_greetings)].map(text);
  while (greetings.at(-1) === '') greetings.pop();
  const card: Card = {
    name: text(data.name),
    nickname: text(data.nickname) || null,
    description: text(data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    greetings,
    exampleDialogue: text(data.mes_example),
    systemPrompt: text(data.system_prompt),
    postHistoryInstructions: text(data.post_history_instructions),
    creatorNotes: text(data.creator_notes),
    creator: text(data.creator),
    version: typeof data.character_version === 'number' ? String(data.character_version) : text(data.character_version),
    tags: strings(data.tags),
    variables: variables(risu.defaultVariables),
    toggles: text(risu.toggles),
    utility: risu.utilityBot === true,
    bias: list(risu.bias)
      .filter((pair): pair is [string, number] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number')
      .map(([key, value]): [string, number] => [key, value]),
    regex: regexScripts(module ? list(module.regex) : list(risu.customScripts), tally),
    loreSettings: {
      scanDepth: count(book.scan_depth),
      tokenBudget: count(book.token_budget),
      recursive: flag(book.recursive_scanning),
      fullWordMatching: flag(record(book.extensions).risu_fullWordMatching),
    },
  };
  const { lore, loreFolders } =
    module && Array.isArray(module.lorebook) ? lorebook(module.lorebook, RISU_LORE) : lorebook(list(book.entries), BOOK_LORE);
  countInText(card, lore, tally);
  return { card, lore, loreFolders, spec, icon: icon && text(icon.uri) };
}

// Tavern v1, including the char_* names of older exports that Risu's JSON check accepts.
function tavern(raw: Json): Json | null {
  const name = raw.name ?? raw.char_name;
  const description = raw.description ?? raw.char_persona;
  const greeting = raw.first_mes ?? raw.char_greeting;
  if (typeof name !== 'string' || typeof description !== 'string' || typeof greeting !== 'string') return null;
  return {
    name,
    description,
    personality: raw.personality,
    scenario: raw.scenario ?? raw.world_scenario,
    first_mes: greeting,
    mes_example: raw.mes_example ?? raw.example_dialogue,
  };
}

// CCv3: the icon named main, else the first icon.
function pickIcon(assets: unknown[]): Json | null {
  const icons = assets.filter((asset): asset is Json => isRecord(asset) && asset.type === 'icon');
  return icons.find((asset) => asset.name === 'main') ?? icons[0] ?? null;
}

const isLua = (trigger: unknown) => isRecord(trigger) && record(list(trigger.effect)[0]).type === 'triggerlua';

// Each line splits at its first '=' (design §5); Risu cuts the value at a second '='. `key=` keeps '' as the
// default, where Risu drops the line.
function variables(value: unknown): [string, string][] {
  return text(value)
    .split(/\r?\n/)
    .flatMap((line): [string, string][] => {
      const at = line.indexOf('=');
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
    });
}

// Scripts on other stages (edittrans, disabled) never run in risu-alpha and are counted instead.
function regexScripts(scripts: unknown[], tally: Tally): RegexScript[] {
  return scripts.filter(isRecord).flatMap((script) => {
    const stage = STAGES.get(script.type);
    if (!stage) {
      add(tally, 'regex-stage');
      return [];
    }
    return [{ name: text(script.comment), find: text(script.in), replace: text(script.out), stage, flags: (script.ableFlag === true && text(script.flag)) || null }];
  });
}

type LoreSource = { folderId(raw: Json): string; name(raw: Json): string; entry(raw: Json): Entry };

// A folder is an entry with mode 'folder'; the entries in it name its key (lorebook.svelte.ts:45-73).
function lorebook(raws: unknown[], source: LoreSource): { lore: LoreEntry[]; loreFolders: string[] } {
  const entries = raws.filter(isRecord);
  const folders = new Map<string, number>();
  const loreFolders: string[] = [];
  for (const raw of entries.filter((raw) => raw.mode === 'folder')) {
    folders.set(source.folderId(raw), loreFolders.length);
    loreFolders.push(source.name(raw));
  }
  const lore = entries
    .filter((raw) => raw.mode !== 'folder')
    .map((raw) => ({ name: source.name(raw), ...source.entry(raw), folder: folders.get(text(raw.folder)) ?? null }));
  return { lore, loreFolders };
}

// Risu's own lore, from module.risum.
const RISU_LORE: LoreSource = {
  folderId: (raw) => text(raw.key),
  name: (raw) => text(raw.comment),
  entry: (raw) => ({
    keys: split(raw.key),
    secondaryKeys: split(raw.secondkey),
    content: typeof raw.bookVersion === 'number' && raw.bookVersion >= 2 ? text(raw.content) : migrate(text(raw.content), raw.activationPercent),
    // Risu's own lore has no enabled flag.
    enabled: true,
    constant: raw.alwaysActive === true,
    selective: raw.selective === true,
    useRegex: raw.useRegex === true,
    caseSensitive: record(raw.extentions).risu_case_sensitive === true,
    insertionOrder: order(raw.insertorder),
    priority: null,
    position: null,
  }),
};

// CCv3 character_book entries.
const BOOK_LORE: LoreSource = {
  folderId: (raw) => keys(raw.keys)[0] ?? '',
  name: (raw) => text(raw.name) || text(raw.comment),
  entry: (raw) => {
    const extensions = record(raw.extensions);
    const secondaryKeys = keys(raw.secondary_keys);
    let selective = raw.selective === true;
    let content = text(raw.content);
    const prepend = (line: string) => {
      content = `${line}\n${content}`;
    };
    // SillyTavern's entry extensions become decorators, prepended in Risu's order (characterCards.ts:1065-1119).
    if (extensions.useProbability === true && typeof extensions.probability === 'number' && extensions.probability !== 100) {
      prepend(`@@probability ${extensions.probability}`);
    }
    const role = typeof extensions.role === 'number' ? ROLES[extensions.role] : undefined;
    if (extensions.position === 4 && typeof extensions.depth === 'number' && role) prepend(`@@depth ${extensions.depth}\n@@role ${role}`);
    switch (secondaryKeys.length > 0 ? extensions.selectiveLogic : undefined) {
      case 1:
        selective = false;
        prepend(`@@exclude_keys_all ${secondaryKeys.join(',')}`);
        break;
      case 2:
        selective = false;
        for (const key of secondaryKeys) prepend(`@@exclude_keys ${key}`);
        break;
      case 3:
        selective = false;
        for (const key of secondaryKeys) prepend(`@@additional_keys ${key}`);
        break;
    }
    if (typeof extensions.delay === 'number' && extensions.delay > 0) prepend(`@@activate_only_after ${extensions.delay}`);
    if (typeof extensions.match_whole_words === 'boolean') prepend(extensions.match_whole_words ? '@@match_full_word' : '@@match_partial_word');
    return {
      keys: keys(raw.keys),
      secondaryKeys,
      content: migrate(content, extensions.risu_activationPercent),
      // Honored (design §5, 5a and 5b); Risu drops enabled and never reads case_sensitive.
      enabled: raw.enabled !== false,
      caseSensitive: raw.case_sensitive === true,
      constant: raw.constant === true,
      selective,
      useRegex: raw.use_regex === true,
      insertionOrder: order(raw.insertion_order),
      priority: typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : null,
      position: raw.position === 'before_char' || raw.position === 'after_char' ? raw.position : null,
    };
  },
};

// Risu's one-time lore migration (updateLorebooks, characters.ts:648-663), the one rewrite design §5 allows.
// @@end is matched as a whole decorator: Risu's unanchored pattern also rewrites text such as "@@endless".
function migrate(content: string, percent: unknown): string {
  const probability = typeof percent === 'number' && Number.isFinite(percent) && percent !== 0 ? `@@probability ${percent}\n` : '';
  return (probability + content)
    .replace(/^@@@?end(?=[ \t\r]|$)/gm, '@@depth 0')
    .replace(/<(char|bot)>/g, '{{char}}')
    .replace(/<user>/g, '{{user}}');
}

// Unsupported content inside text stays verbatim; it is only counted.
function countInText(card: Card, lore: LoreEntry[], tally: Tally) {
  const texts = [
    card.description,
    card.personality,
    card.scenario,
    ...card.greetings,
    card.exampleDialogue,
    card.systemPrompt,
    card.postHistoryInstructions,
    ...card.bias.map(([key]) => key),
    ...card.regex.flatMap((script) => [script.find, script.replace]),
    ...lore.map((entry) => entry.content),
  ];
  for (const value of texts) {
    for (const [, name] of value.matchAll(/\{\{([^{}:]*)/g)) {
      if (UNSUPPORTED_TAGS.has(name!.toLowerCase().replace(/[\s_-]/g, ''))) add(tally, 'cbs-tag');
    }
  }
  for (const entry of lore) add(tally, 'disable-ui-prompt', parseDecorators(entry.content).decorators.filter(({ name }) => name === 'disable_ui_prompt').length);
}
