import { isRecord, list } from '../../connectors/values';
import type { Block, ChatRange, ConversationPrompt, Role, SLOTS, SlotKind, TextBlock } from '../../model/prompt';
import { add, counted, text, type Json, type Tally } from './convert';
import { gunzip } from './inflate';
import { readMsgpack } from './msgpack';
import { unpack } from './risum';
import { readToggles } from './toggles';

// What a preset holds that the prompt does not take, in the order the summary lists it.
const UNSUPPORTED = ['jailbreak', 'cot', 'chatml', 'cache-narrowed', 'unread-item', 'repeated-slot', 'toggle-line', 'preset-text', 'regex', 'variables', 'settings'] as const;
export type PresetUnsupportedKind = (typeof UNSUPPORTED)[number];
type Counted = Exclude<PresetUnsupportedKind, 'repeated-slot'>;
// A repeated slot is listed once per slot, so the summary can name it.
export type PresetUnsupported = { kind: Counted; count: number } | { kind: 'repeated-slot'; slot: SlotKind; count: number };

// unreadable: not RPack'd gzip'd MessagePack. not-preset: a Risu container of another type. decrypt-failed:
// the preset inside does not open. no-template: a legacy preset, which risu-alpha does not assemble.
export type PresetFailure = { kind: 'unreadable' | 'not-preset' | 'decrypt-failed' | 'no-template' };
export type PresetRead = { prompt: ConversationPrompt; unsupported: PresetUnsupported[] };
export type PresetResult = ({ ok: true } & PresetRead) | { ok: false; failure: PresetFailure };

const ROLES = new Map<unknown, Role>([
  ['system', 'system'],
  ['user', 'user'],
  ['bot', 'assistant'],
]);
const MARKS = new Map<unknown, TextBlock['mark']>([
  ['normal', null],
  ['main', 'main'],
  ['globalNote', 'globalNote'],
]);
const WRAPPED = new Map<unknown, 'description' | 'persona' | 'authorNote' | 'memory'>([
  ['description', 'description'],
  ['persona', 'persona'],
  ['authornote', 'authorNote'],
  ['memory', 'memory'],
]);
const SKIPPED = new Map<unknown, Counted>([
  ['jailbreak', 'jailbreak'],
  ['cot', 'cot'],
  ['chatML', 'chatml'],
]);
// A slot placed again where the model allows it once keeps its first place; SLOTS decides which repeat.
type Repeating = { [K in SlotKind]: (typeof SLOTS)[K]['repeats'] extends true ? K : never }[SlotKind];
const REPEATING: Record<Repeating, true> = { chat: true, description: true };

const fail = (kind: PresetFailure['kind']): PresetResult => ({ ok: false, failure: { kind } });

// Risu's preset container (compat spec, out-of-scope formats), told apart by extension as Risu does: a .risup is
// RPack over gzip, a .risupreset gzip alone. Inside is MessagePack {type: 'preset', preset}, where preset is
// MessagePack under AES-GCM; presetVersion 0 names the field pres. The key is SHA-256 of a fixed string and the IV
// is zero: the format hides the preset from casual reading, it does not protect it.
export async function importPreset(fileName: string, bytes: Uint8Array): Promise<PresetResult> {
  if (!isPresetFile(fileName)) return fail('unreadable');
  const packed = fileName.toLowerCase().endsWith('.risup');
  let outer: unknown;
  try {
    outer = readMsgpack(gunzip(packed ? unpack(bytes) : bytes));
  } catch {
    return fail('unreadable');
  }
  const sealed = isRecord(outer) ? (outer.preset ?? outer.pres) : null;
  if (!isRecord(outer) || outer.type !== 'preset' || !(sealed instanceof Uint8Array)) return fail('not-preset');
  let opened: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('risupreset')), 'AES-GCM', false, ['decrypt']);
    opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, sealed.slice());
  } catch {
    return fail('decrypt-failed');
  }
  let preset: unknown;
  try {
    preset = readMsgpack(new Uint8Array(opened));
  } catch {
    return fail('unreadable');
  }
  return convertPreset(preset);
}

export const PRESET_EXTENSIONS = ['.risup', '.risupreset'];
export const isPresetFile = (fileName: string) => PRESET_EXTENSIONS.some((extension) => fileName.toLowerCase().endsWith(extension));

// A Risu preset object, as a .risup holds it and as a backup's botPresets lists it.
export function convertPreset(preset: unknown): PresetResult {
  if (!isRecord(preset)) return fail('unreadable');
  if (!Array.isArray(preset.promptTemplate)) return fail('no-template');
  return { ok: true, ...convert(preset, preset.promptTemplate) };
}

function convert(preset: Json, template: unknown[]): PresetRead {
  const counts: Tally<Counted> = new Map();
  const count = (kind: Counted, amount = 1) => add(counts, kind, amount);
  const repeated: Tally<SlotKind> = new Map();
  const blocks: Block[] = [];
  const placed = new Set<SlotKind>();
  let authorNote = '';
  for (const item of template) {
    if (!isRecord(item)) {
      count('unread-item');
      continue;
    }
    // Risu's cache item marks the last `depth` messages before it, of one role or of all; 여기까지 캐시 on the block
    // before it marks the one message before it, which is Risu's depth 1 over all roles. One at the top marks nothing
    // in Risu either.
    if (item.type === 'cache') {
      if (!(item.depth === 1 && item.role === 'all')) count('cache-narrowed');
      const before = blocks.at(-1);
      if (before) blocks[blocks.length - 1] = { ...before, cache: true };
      continue;
    }
    const read = block(item);
    if (typeof read === 'string') {
      count(read);
      continue;
    }
    if (read.kind === 'slot' && !Object.hasOwn(REPEATING, read.slot)) {
      if (placed.has(read.slot)) {
        add(repeated, read.slot);
        continue;
      }
      placed.add(read.slot);
      if (read.slot === 'authorNote') authorNote = text(item.defaultText);
    }
    blocks.push(read);
  }

  const toggles = readToggles(text(preset.customPromptTemplateToggle));
  count('toggle-line', toggles.filter((line) => line.kind === 'unread').length);
  // A template preset sends none of these texts (compat spec, legacy-only buckets); its jailbreak goes only
  // through a jailbreak item, counted above.
  count('preset-text', [preset.mainPrompt, preset.jailbreak, preset.globalNote].filter((value) => text(value).trim()).length);
  count('regex', list(preset.regex).length);
  // They default chat variables (getvar), not toggles, which are globals with no default (compat spec §d).
  count('variables', text(preset.templateDefaultVariables).split(/\r?\n/).filter((line) => line.trim()).length);
  // Model, generation and prompt settings belong to each model's settings; every preset has them.
  count('settings');

  const companions = text(preset.moduleIntergration).split(',').map((name) => name.trim()).filter(Boolean);
  // Preset model names are not this account's connections, so the prompt's model layer starts empty.
  return {
    prompt: { name: text(preset.name), blocks, toggles, authorNote, models: {}, imported: 'risu-preset', ...(companions.length > 0 && { companions }) },
    unsupported: UNSUPPORTED.flatMap((kind): PresetUnsupported[] => (kind === 'repeated-slot' ? [...repeated].map(([slot, amount]) => ({ kind, slot, count: amount })) : counted([kind], counts))),
  };
}

// One template item (compat spec §e, Template assembly). Fields a type does not use, such as a persona
// item's range, are ignored.
function block(item: Json): Block | Counted {
  const skipped = SKIPPED.get(item.type);
  if (skipped) return skipped;
  const named = { id: crypto.randomUUID(), name: text(item.name) || null };
  const role = ROLES.get(item.role);
  const wrapped = WRAPPED.get(item.type);
  if (wrapped) {
    // The role on these is an optional override of the bucket's, which is system (compat spec, Template assembly).
    // Current Risu keeps it in `role2`; older editors wrote `role` (export spec, Finding: role2).
    const override = item.role2 ?? item.role;
    const placedAs = override === undefined ? 'system' : ROLES.get(override);
    return placedAs ? { ...named, kind: 'slot', slot: wrapped, role: placedAs, wrapper: text(item.innerFormat) || null } : 'unread-item';
  }
  switch (item.type) {
    case 'plain': {
      const mark = MARKS.get(item.type2);
      return role && mark !== undefined && typeof item.text === 'string' ? { ...named, kind: 'text', role, text: item.text, mark } : 'unread-item';
    }
    case 'lorebook':
    case 'postEverything':
      return { ...named, kind: 'slot', slot: item.type };
    case 'chat': {
      const range = chatRange(item.rangeStart, item.rangeEnd);
      return range ? { ...named, kind: 'slot', slot: 'chat', range } : 'unread-item';
    }
  }
  return 'unread-item';
}

// Risu slices [rangeStart, rangeEnd): negative counts from the end, 'end' is the end, and -1000 means all,
// read here as the far end on either side.
function chatRange(start: unknown, end: unknown): ChatRange | null {
  const from = start === -1000 ? 0 : start;
  const to = end === 'end' || end === -1000 ? null : end;
  if (typeof from !== 'number' || !Number.isInteger(from)) return null;
  if (to !== null && (typeof to !== 'number' || !Number.isInteger(to))) return null;
  return { from, to };
}
