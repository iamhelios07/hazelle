import { isRecord } from '../../connectors/values';
import { assetUrl, findAsset } from '../assets';
import { seeded } from '../random';
import { escapeCbs } from './escape';
import type { CbsContext } from './evaluate';
import { calc } from './math';
import { calendarDate, clockTime, duration, formatTime } from './time';

export type Env = {
  context: CbsContext;
  // Whether setvar, addvar and setdefaultvar write: only in a chat message's own text.
  writes: boolean;
  temp: Map<string, string>;
  // The tag's own rolls, placed by where it stands.
  random: () => number;
  // Card, persona and prompt texts go out through this, never as they are: they hold CBS of their own, and
  // write no variables.
  insert: (text: string) => string;
  call: (name: string, args: string[]) => string | null;
  arg: (index: number) => string | null;
  slot: (name: string) => string | null;
};

// {{return}} ends the nearest parse (the whole text, a {{call}} or an inserted text) with its value.
export class Return {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
}

// null: the tag stays as written, as it does with fewer than min arguments.
type Run = (args: string[], env: Env) => string | null;
const HANDLERS = new Map<string, { min: number; run: Run }>();

// names: the tag and its aliases, written normalized, since a name read from text is normalized first.
function define(names: string, min: number, run: Run) {
  for (const name of names.split(' ')) HANDLERS.set(name, { min, run });
}

export const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]/g, '');
export const handlerFor = (name: string) => HANDLERS.get(normalize(name));

// Tags Risu has that risu-alpha does not evaluate, normalized. They stay as written, and import counts them.
const UNSUPPORTED = new Set([
  // Marked X in risu-compat-spec §d, with their aliases in src/ts/cbs.ts at ca1345fc. The internal-only `__`
  // is left out, since normalizing empties its name.
  'triggerid',
  'emotionlist',
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
  'video',
  'audio',
  'bgm',
  'bg',
  'emotion',
  'videoimg',
  'inlay',
  'inlayed',
  'inlayeddata',
  'assetprompt',
  // risu-alpha prompts have no jailbreak.
  'jb',
  'jailbreak',
  'jbtoggled',
  // Marked N, but nothing to read: no auxiliary model is assigned yet, and the spec gives the rest no semantics.
  'axmodel',
  'metadata',
  'declare',
  'range',
  'filter',
  'u',
  'ue',
  'tex',
  'ruby',
  'codeblock',
]);

export const isUnsupportedTag = (name: string) => UNSUPPORTED.has(normalize(name));

export const bool = (value: boolean) => (value ? '1' : '0');
// The one truthiness, for #when, #if and the logic tags. Risu's and/or/not take only `1`.
export const truthy = (value: string) => value === '1' || value === 'true';

// An unset variable reads as empty, so addvar counts from 0. Risu reads the string `null`.
export const readVar = (context: CbsContext, name: string) => context.variables.get(name) ?? '';
export const readToggle = (context: CbsContext, key: string) => context.toggle(key) ?? '';
// risu-alpha keeps no global variables: a toggle reads as `toggle_<key>`, and every other name is unset.
export const TOGGLE_GLOBAL = 'toggle_';
const readGlobal = (context: CbsContext, name: string) => (name.startsWith(TOGGLE_GLOBAL) ? readToggle(context, name.slice(TOGGLE_GLOBAL.length)) : '');

const messageIndex = (context: CbsContext) => ('message' in context.source ? context.source.message : null);
// A bot reads the greeting as message -1 and the first message after it as 0, so a message's number is its index
// less this.
const opened = (context: CbsContext) => (context.greeting === null ? 0 : 1);
const currentMessage = (context: CbsContext) => {
  const index = messageIndex(context);
  return index === null ? undefined : context.messages[index];
};

// Arrays and dicts go out as JSON with each `::` escaped, so a tag that takes one as an argument is not
// split inside it.
const serialize = (value: unknown) => JSON.stringify(value).replaceAll('::', '\\u003a\\u003a');
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
// An array argument: a JSON array, or items separated by `§`.
export function items(text: string): string[] {
  if (text === '') return [];
  const value = json(text);
  return Array.isArray(value) ? value.map(asText) : text.split('§');
}
function dict(text: string): Record<string, unknown> {
  const value = json(text);
  return isRecord(value) ? value : {};
}
const variadic = (args: string[]) => (args.length === 1 ? items(args[0]!) : args);
const numbers = (args: string[]) => variadic(args).map(Number);

const cardText = (field: 'description' | 'personality' | 'scenario' | 'exampleDialogue'): Run => (_, { context, insert }) => (context.card ? insert(context.card[field]) : null);
define('char bot', 0, (_, { context: { card } }) => card && (card.nickname || card.name));
define('user', 0, (_, { context: { persona } }) => persona && persona.name);
define('persona userpersona', 0, (_, { context: { persona }, insert }) => persona && insert(persona.description));
define('description chardesc', 0, cardText('description'));
define('personality charpersona', 0, cardText('personality'));
define('scenario', 0, cardText('scenario'));
define('exampledialogue examplemessage', 0, cardText('exampleDialogue'));
const promptText = (field: 'main' | 'globalNote' | 'authorNote'): Run => (_, { context, insert }) => (context.prompt ? insert(context.prompt[field]) : null);
define('mainprompt systemprompt', 0, promptText('main'));
define('globalnote systemnote ujb', 0, promptText('globalNote'));
define('authornote', 0, promptText('authorNote'));
define('lorebook worldinfo', 0, (_, { context }) => serialize(context.lore));

// Risu's markup, which the display dims until a bot's buttons can run (design §6.4).
define('button', 2, ([label, trigger]) => `<button class="button-default" risu-trigger="${trigger}">${label}</button>`);

// A bot's pictures show on screen only; the prompt keeps these tags as written, as in Risu (design §6.4). A name that
// finds no asset shows nothing.
const assetTag = (render: (url: string) => string): Run => ([name], { context, random }) => {
  if (context.stage !== 'display') return null;
  const asset = findAsset(context.assets, name!, random);
  return asset ? render(assetUrl(asset.id)) : '';
};
define('raw path', 1, assetTag((url) => url));
define('img', 1, assetTag((url) => `<img src="${url}">`));
define('image', 1, assetTag((url) => `<div class="risu-inlay-image"><img src="${url}"></div>\n`));
define('asset', 1, assetTag((url) => `<img src="${url}">\n`));
define('source', 1, ([name], { context: { stage, faces } }) => {
  if (stage !== 'display') return null;
  const face = name!.toLowerCase();
  return (face === 'char' ? faces.char : face === 'user' ? faces.user : null) ?? '';
});
// The names a bot's prompt lists, so the model can pick pictures by name.
define('assetlist', 0, (_, { context: { card, assets } }) => (card ? serialize(assets.map(({ name }) => name)) : ''));

define('getvar', 1, ([name], { context }) => readVar(context, name!));
define('setvar', 2, ([name, value], { context, writes }) => {
  if (writes) context.variables.set(name!, value!);
  return '';
});
define('addvar', 2, ([name, amount], { context, writes }) => {
  if (writes) context.variables.set(name!, String(Number(readVar(context, name!)) + Number(amount)));
  return '';
});
define('setdefaultvar', 2, ([name, value], { context, writes }) => {
  if (writes && readVar(context, name!) === '') context.variables.set(name!, value!);
  return '';
});
define('getglobalvar', 1, ([name], { context }) => readGlobal(context, name!));
define('tempvar gettempvar', 1, ([name], { temp }) => temp.get(name!) ?? '');
define('settempvar', 2, ([name, value], { temp }) => {
  temp.set(name!, value!);
  return '';
});
define('return', 1, ([value]) => {
  throw new Return(value!);
});
define('call', 1, ([name, ...args], env) => env.call(name!, args));
define('arg', 1, ([index], env) => env.arg(Number(index)));
define('slot', 1, ([name], env) => env.slot(name!));

define('equal', 2, ([a, b]) => bool(a === b));
define('notequal', 2, ([a, b]) => bool(a !== b));
define('greater', 2, ([a, b]) => bool(Number(a) > Number(b)));
define('less', 2, ([a, b]) => bool(Number(a) < Number(b)));
define('greaterequal', 2, ([a, b]) => bool(Number(a) >= Number(b)));
define('lessequal', 2, ([a, b]) => bool(Number(a) <= Number(b)));
define('and', 2, ([a, b]) => bool(truthy(a!) && truthy(b!)));
define('or', 2, ([a, b]) => bool(truthy(a!) || truthy(b!)));
define('not', 1, ([a]) => bool(!truthy(a!)));
define('all', 1, (args) => bool(variadic(args).every(truthy)));
define('any', 1, (args) => bool(variadic(args).some(truthy)));
define('iserror', 1, ([text]) => bool(/^error:/i.test(text!)));

// A value that is not a number counts as 0.
const variableNumber = (context: CbsContext) => (token: string) => {
  const value = Number(token.startsWith('$') ? readVar(context, token.slice(1)) : readGlobal(context, token.slice(1)));
  return Number.isNaN(value) ? 0 : value;
};
define('calc', 1, ([expression], { context }) => {
  const value = calc(expression!, variableNumber(context));
  return value === null ? null : String(value);
});
define('round', 1, ([n]) => String(Math.round(Number(n))));
define('floor', 1, ([n]) => String(Math.floor(Number(n))));
define('ceil', 1, ([n]) => String(Math.ceil(Number(n))));
define('abs', 1, ([n]) => String(Math.abs(Number(n))));
define('remaind', 2, ([a, b]) => String(Number(a) % Number(b)));
define('pow', 2, ([a, b]) => String(Number(a) ** Number(b)));
define('fixnum', 2, ([n, digits]) => Number(n).toFixed(Number(digits)));
define('min', 1, (args) => String(Math.min(...numbers(args))));
define('max', 1, (args) => String(Math.max(...numbers(args))));
define('sum', 1, (args) => String(numbers(args).reduce((total, n) => total + n, 0)));
define('average', 1, (args) => {
  const all = numbers(args);
  return String(all.reduce((total, n) => total + n, 0) / all.length);
});
define('tonumber', 1, ([text]) => text!.replace(/[^\d.-]/g, ''));
define('fromhex', 1, ([hex]) => String(parseInt(hex!, 16)));
define('tohex', 1, ([n]) => Number(n).toString(16));

// One argument is a JSON array, or a list split at each `,` or `:` (`\,` keeps a comma).
function options(text: string): string[] {
  const listed = json(text);
  return Array.isArray(listed) ? listed.map(asText) : text.split(/(?<!\\)[,:]/).map((option) => option.replaceAll('\\,', ','));
}
function choose(args: string[], next: () => number): string | null {
  if (args.length === 0) return String(next());
  const from = args.length > 1 ? args : options(args[0]!);
  return from[Math.floor(next() * from.length)] ?? null;
}
function roll(notation: string, next: () => number): string | null {
  const [, count, sides] = /^(?:(\d*)d)?(\d+)$/i.exec(notation.trim()) ?? [];
  if (sides === undefined || Number(sides) < 1) return null;
  let total = 0;
  for (let i = 0; i < (count ? Number(count) : 1); i++) total += Math.floor(next() * Number(sides)) + 1;
  return String(total);
}
// pick and rollp keep Risu's seed, the character, chat and message count, and not the tag's place.
const pickRolls = (context: CbsContext) => seeded(context.pickSeed);
define('random', 0, (args, { random }) => choose(args, random));
define('pick', 0, (args, { context }) => choose(args, pickRolls(context)));
define('randint', 2, ([low, high], { random }) => {
  const [min, max] = [Math.ceil(Number(low)), Math.floor(Number(high))];
  return min <= max ? String(min + Math.floor(random() * (max - min + 1))) : null;
});
define('dice', 1, ([notation], { random }) => roll(notation!, random));
// With no argument, 1d6; Risu returns 1.
define('roll', 0, ([notation = '1d6'], { random }) => roll(notation, random));
define('rollp rollpick', 0, ([notation = '1d6'], { context }) => roll(notation, pickRolls(context)));
define('hash', 1, ([text]) => String(1_000_000 + Math.floor(seeded(text!)() * 9_000_000)));

// A timestamp argument is in seconds, as documented.
const formatAt = ([format, timestamp]: string[], { now, timeZone }: CbsContext['clock']) =>
  formatTime(format!, timestamp === undefined ? now : Number(timestamp) * 1000, timeZone);
define('time', 0, (args, { context: { clock } }) => (args.length ? formatAt(args, clock) : clockTime(clock.now, clock.timeZone)));
define('date datetimeformat', 0, (args, { context: { clock } }) => (args.length ? formatAt(args, clock) : calendarDate(clock.now, clock.timeZone)));
define('unixtime', 0, (_, { context }) => String(Math.floor(context.clock.now / 1000)));
define('isotime', 0, (_, { context }) => clockTime(context.clock.now, 'UTC'));
define('isodate', 0, (_, { context }) => calendarDate(context.clock.now, 'UTC'));
define('messagetime', 0, (_, { context }) => {
  const time = currentMessage(context)?.time ?? null;
  return time === null ? null : clockTime(time, context.clock.timeZone);
});
define('messagedate', 0, (_, { context }) => {
  const time = currentMessage(context)?.time ?? null;
  return time === null ? null : calendarDate(time, context.clock.timeZone);
});
define('idleduration', 0, (_, { context }) => {
  const time = context.messages.at(-1)?.time ?? null;
  return time === null ? null : duration(context.clock.now - time);
});
define('messageidleduration', 0, (_, { context }) => {
  const index = messageIndex(context);
  const before = index === null ? null : (context.messages[index - 1]?.time ?? null);
  const time = currentMessage(context)?.time ?? null;
  return before === null || time === null ? null : duration(time - before);
});
define('messageunixtimearray', 0, (_, { context }) => serialize(context.messages.map(({ time }) => (time === null ? null : Math.floor(time / 1000)))));

// Chat tags read stored text, tags and all: risu-alpha never bakes a message.
const lastOf = (context: CbsContext, role: 'user' | 'assistant') => {
  const before = messageIndex(context) ?? context.messages.length;
  return context.messages.slice(0, before).findLast((message) => message.role === role)?.text ?? '';
};
define('lastmessage', 0, (_, { context }) => context.messages.at(-1)?.text ?? '');
define('lastmessageid lastmessageindex', 0, (_, { context }) => (context.messages.length ? String(context.messages.length - 1 - opened(context)) : null));
define('previouscharchat lastcharmessage', 0, (_, { context }) => lastOf(context, 'assistant'));
define('previoususerchat lastusermessage', 0, (_, { context }) => lastOf(context, 'user'));
define('previouschatlog', 1, ([number], { context }) => context.messages[Number(number) + opened(context)]?.text ?? 'Out of range');
define('history messages', 0, (_, { context }) => serialize(context.messages.map(({ text }) => text)));
define('userhistory', 0, (_, { context }) => serialize(context.messages.filter(({ role }) => role === 'user').map(({ text }) => text)));
define('charhistory', 0, (_, { context }) => serialize(context.messages.filter(({ role }) => role === 'assistant').map(({ text }) => text)));
define('chatindex', 0, (_, { context }) => {
  const index = messageIndex(context);
  return index === null ? null : String(index - opened(context));
});
define('firstmsgindex', 0, (_, { context: { greeting } }) => (greeting && greeting.index !== null ? String(greeting.index) : null));
// Risu names a character's message `char`, which bots compare against.
define('role', 0, (_, { context }) => {
  const role = currentMessage(context)?.role;
  return role === undefined ? null : role === 'user' ? 'user' : 'char';
});
define('isfirstmsg', 0, (_, { context }) => bool(context.greeting !== null && messageIndex(context) === 0));

define('replace', 3, ([text, find, replacement]) => text!.replaceAll(find!, replacement!));
define('split', 2, ([text, separator]) => serialize(text!.split(separator!)));
define('join', 2, ([array, separator]) => items(array!).join(separator));
// Its items become the arguments of the tag around it.
define('spread', 1, ([array]) => items(array!).join('::'));
define('trim', 1, ([text]) => text!.trim());
define('length', 1, ([text]) => String([...text!].length));
define('lower', 1, ([text]) => text!.toLowerCase());
define('upper', 1, ([text]) => text!.toUpperCase());
define('capitalize', 1, ([text]) => text!.charAt(0).toUpperCase() + text!.slice(1));
define('startswith', 2, ([text, prefix]) => bool(text!.startsWith(prefix!)));
define('endswith', 2, ([text, suffix]) => bool(text!.endsWith(suffix!)));
define('contains', 2, ([text, part]) => bool(text!.includes(part!)));
define('reverse', 1, ([text]) => [...text!].reverse().join(''));
define('unicodeencode', 1, ([text, index = '0']) => {
  const code = text!.codePointAt(Number(index));
  return code === undefined ? null : String(code);
});
define('unicodedecode', 1, ([code]) => String.fromCodePoint(Number(code)));

define('makearray array a', 0, (args) => serialize(args));
define('makedict dict object o d', 0, (args) =>
  serialize(Object.fromEntries(args.flatMap((pair) => (pair.includes('=') ? [[pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]] : [])))),
);
define('arraylength', 1, ([array]) => String(items(array!).length));
define('arrayelement', 2, ([array, index]) => items(array!)[Number(index)] ?? '');
define('dictelement', 2, ([object, key]) => {
  const value = dict(object!)[key!];
  return value === undefined ? '' : asText(value);
});
define('element ele', 1, ([root, ...path]) => {
  let value = json(root!);
  for (const key of path) value = Array.isArray(value) ? value[Number(key)] : isRecord(value) ? value[key] : undefined;
  return value === undefined ? '' : asText(value);
});
// These return the changed array or dict, not the item removed as JS's shift and pop do, so a setvar can keep it.
define('objectassert', 3, ([object, key, value]) => {
  const current = dict(object!);
  return serialize(Object.hasOwn(current, key!) ? current : { ...current, [key!]: value });
});
define('arrayassert', 3, ([array, index, value]) => {
  const current = items(array!);
  const at = Number(index);
  if (!Number.isSafeInteger(at) || at < 0) return null;
  return serialize(Array.from({ length: Math.max(current.length, at + 1) }, (_, n) => current[n] ?? (n === at ? value : '')));
});
define('arrayshift', 1, ([array]) => serialize(items(array!).slice(1)));
define('arraypop', 1, ([array]) => serialize(items(array!).slice(0, -1)));
define('arraypush', 2, ([array, ...values]) => serialize([...items(array!), ...values]));
define('arraysplice', 3, ([array, start, count, ...insert]) => {
  const current = items(array!);
  current.splice(Number(start), Number(count), ...insert);
  return serialize(current);
});

define('br newline', 0, () => '\n');
define('blank none', 0, () => '');
// A backslash and an n, not a line break; with a count, that many.
define('cbr', 0, ([count = '1']) => '\\n'.repeat(Number(count)));
define('bo', 0, () => escapeCbs('{{'));
define('bc', 0, () => escapeCbs('}}'));
define('decbo', 0, () => escapeCbs('{'));
define('decbc', 0, () => escapeCbs('}'));
for (const char of '()<>:;') define(char, 0, () => escapeCbs(char));
define('comment', 1, ([text], { context }) => (context.stage === 'display' ? text! : ''));
// The lorebook track scans the entry's raw text, so the key still chains entries.
define('hiddenkey', 1, () => '');

define('language', 0, (_, { context: { language } }) => language);
define('model', 0, (_, { context: { model } }) => model && model.id);
define('maxcontext', 0, (_, { context: { model } }) => (model && model.maxContext !== null ? String(model.maxContext) : null));
define('prefillsupported prefill', 0, (_, { context: { model } }) => (model && model.prefill !== null ? bool(model.prefill) : null));
define('screenwidth', 0, (_, { context }) => (context.screen ? String(context.screen.width) : null));
define('screenheight', 0, (_, { context }) => (context.screen ? String(context.screen.height) : null));
