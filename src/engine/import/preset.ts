import { gunzipSync } from 'fflate';
import { isRecord, list } from '../../connectors/values';
import type { Block, ChatRange, ConversationPrompt, Role, SLOTS, SlotKind, TextBlock } from '../../model/prompt';
import { add, counted, type Tally } from './convert';
import { readMsgpack } from './msgpack';
import { unpack } from './risum';
import { readToggles } from './toggles';

type Json = Record<string, unknown>;

// What a preset holds that the prompt does not take, in the order the summary lists it.
const UNSUPPORTED = ['jailbreak', 'cot', 'chatml', 'cache-narrowed', 'unread-item', 'repeated-slot', 'toggle-line', 'preset-text', 'regex', 'variables', 'settings'] as const;
export type PresetUnsupportedKind = (typeof UNSUPPORTED)[number];
export type PresetUnsupported = { kind: PresetUnsupportedKind; count: number };

// unreadable: not RPack'd gzip'd MessagePack. not-preset: a Risu container of another type. decrypt-failed:
// the preset inside does not open. no-template: a legacy preset, which risu-alpha does not assemble.
export type PresetFailure = { kind: 'unreadable' | 'not-preset' | 'decrypt-failed' | 'no-template' };
export type PresetResult = { ok: true; prompt: ConversationPrompt; unsupported: PresetUnsupported[] } | { ok: false; failure: PresetFailure };

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
const SKIPPED = new Map<unknown, PresetUnsupportedKind>([
  ['jailbreak', 'jailbreak'],
  ['cot', 'cot'],
  ['chatML', 'chatml'],
]);
// A slot placed again where the model allows it once keeps its first place; SLOTS decides which repeat.
type Repeating = { [K in SlotKind]: (typeof SLOTS)[K]['repeats'] extends true ? K : never }[SlotKind];
const REPEATING: Record<Repeating, true> = { chat: true };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const fail = (kind: PresetFailure['kind']): PresetResult => ({ ok: false, failure: { kind } });

// Risu's preset container (compat spec, out-of-scope formats), told apart by extension as Risu does: a .risup is
// RPack over gzip, a .risupreset gzip alone. Inside is MessagePack {type: 'preset', preset}, where preset is
// MessagePack under AES-GCM; presetVersion 0 names the field pres. The key is SHA-256 of a fixed string and the IV
// is zero: the format hides the preset from casual reading, it does not protect it.
export async function importPreset(fileName: string, bytes: Uint8Array): Promise<PresetResult> {
  const name = fileName.toLowerCase();
  const packed = name.endsWith('.risup');
  if (!packed && !name.endsWith('.risupreset')) return fail('unreadable');
  let outer: unknown;
  try {
    outer = readMsgpack(gunzipSync(packed ? unpack(bytes) : bytes));
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
  if (!isRecord(preset)) return fail('unreadable');
  if (!Array.isArray(preset.promptTemplate)) return fail('no-template');
  return { ok: true, ...convert(preset, preset.promptTemplate) };
}

function convert(preset: Json, template: unknown[]): { prompt: ConversationPrompt; unsupported: PresetUnsupported[] } {
  const counts: Tally<PresetUnsupportedKind> = new Map();
  const count = (kind: PresetUnsupportedKind, amount = 1) => add(counts, kind, amount);
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
        count('repeated-slot');
        continue;
      }
      placed.add(read.slot);
      if (read.slot === 'authorNote') authorNote = text(item.defaultText);
    }
    blocks.push(read);
  }

  const { toggles, unread } = readToggles(text(preset.customPromptTemplateToggle));
  count('toggle-line', unread);
  // A template preset sends none of these texts (compat spec, legacy-only buckets); its jailbreak goes only
  // through a jailbreak item, counted above.
  count('preset-text', [preset.mainPrompt, preset.jailbreak, preset.globalNote].filter((value) => text(value).trim()).length);
  count('regex', list(preset.regex).length);
  // They default chat variables (getvar), not toggles, which are globals with no default (compat spec §d).
  count('variables', text(preset.templateDefaultVariables).split(/\r?\n/).filter((line) => line.trim()).length);
  // Model, generation and prompt settings belong to each model's settings; every preset has them.
  count('settings');

  // Preset model names are not this account's connections, so the prompt's model layer starts empty.
  return { prompt: { name: text(preset.name), blocks, toggles, authorNote, models: {}, imported: 'risu-preset' }, unsupported: counted(UNSUPPORTED, counts) };
}

// One template item (compat spec §e, Template assembly). Fields a type does not use, such as a persona
// item's range, are ignored.
function block(item: Json): Block | PresetUnsupportedKind {
  const skipped = SKIPPED.get(item.type);
  if (skipped) return skipped;
  const named = { id: crypto.randomUUID(), name: text(item.name) || null };
  const role = ROLES.get(item.role);
  const wrapped = WRAPPED.get(item.type);
  if (wrapped) return role ? { ...named, kind: 'slot', slot: wrapped, role, wrapper: text(item.innerFormat) || null } : 'unread-item';
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
