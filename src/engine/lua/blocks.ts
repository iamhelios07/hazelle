import { isRecord } from '../../connectors/values';
import type { Trigger } from '../import/types';
import { add, read, text, write, type Acting } from './state';

export type Blocks = Extract<Trigger, { kind: 'blocks' }>;
// A condition or an effect as Risu wrote it. It comes from a bot's file, so every field is read as it may be.
type Fields = Record<string, unknown>;

const fields = (value: unknown): Fields => (isRecord(value) ? value : {});
const isTrue = (value: string) => value === 'true' || value === '1';
const numbers = (left: string, right: string) => !Number.isNaN(Number(left)) && !Number.isNaN(Number(right));
const same = (left: string, right: string) => (numbers(left, right) ? Number(left) === Number(right) : left === right);
const holds = (list: string, item: string) => {
  try {
    const parsed: unknown = JSON.parse(list);
    return Array.isArray(parsed) && parsed.includes(item);
  } catch {
    return false;
  }
};

// A trigger's own conditions: the variable's value (or the chat's length, or a text) against the condition's value.
// An operator Risu does not have passes, as it does there.
const CONDITION = new Map<string, (value: string, wanted: string) => boolean>([
  ['true', isTrue],
  ['null', (value) => value === 'null'],
  ['=', (value, wanted) => value === wanted],
  ['!=', (value, wanted) => value !== wanted],
  ['>', (value, wanted) => Number(value) > Number(wanted)],
  ['<', (value, wanted) => Number(value) < Number(wanted)],
  ['>=', (value, wanted) => Number(value) >= Number(wanted)],
  ['<=', (value, wanted) => Number(value) <= Number(wanted)],
]);

// v2If and v2IfAdvanced. Unlike a trigger's conditions, = and != compare as numbers when both sides are numbers.
const COMPARE = new Map<string, (source: string, target: string) => boolean>([
  ['=', same],
  ['!=', (source, target) => !same(source, target)],
  ['>', (source, target) => Number(source) > Number(target)],
  ['<', (source, target) => Number(source) < Number(target)],
  ['>=', (source, target) => Number(source) >= Number(target)],
  ['<=', (source, target) => Number(source) <= Number(target)],
  ['∈', (source, target) => holds(target, source)],
  ['∋', (source, target) => holds(source, target)],
  ['∉', (source, target) => !holds(target, source)],
  ['∌', (source, target) => !holds(source, target)],
  ['≒', (source, target) => (numbers(source, target) ? Math.abs(Number(source) - Number(target)) < 0.0001 : source.toLowerCase().replaceAll(' ', '') === target.toLowerCase().replaceAll(' ', ''))],
  ['≡', (source, target) => (target === 'true' ? isTrue(source) : target === 'false' ? !isTrue(source) : source === target)],
]);

const ARITHMETIC = new Map<string, (had: number, by: number) => number>([
  ['+=', (had, by) => had + by],
  ['-=', (had, by) => had - by],
  ['*=', (had, by) => had * by],
  ['/=', (had, by) => had / by],
  ['%=', (had, by) => had % by],
]);

// The v2EndIndent that closes the block opened at or before `from`, or the end of the trigger.
function closing(effects: Fields[], from: number, indent: number): number {
  const at = effects.findIndex((effect, index) => index >= from && effect.type === 'v2EndIndent' && effect.indent === indent);
  return at === -1 ? effects.length : at;
}

// One of Risu's block triggers, as its runTrigger runs it: the conditions, then, when all pass, the effects, V1 and V2.
// Only the effects the surveyed bots use are here (docs/research/bot-survey.md); any other does nothing and is named in
// run.missing, as a Lua function this app lacks is. The texts of conditions and effects are CBS, which the host
// evaluates.
export async function runBlocks(trigger: Blocks, run: Acting): Promise<void> {
  const cbs = (value: unknown) => run.host.cbs(text(value), [...run.written]);
  // V2 operands say what they are: a text, or with <field>Type 'var' the name of the variable to read. V1's have no
  // type and are texts.
  const operand = async (effect: Fields, field: string) => (effect[`${field}Type`] === 'var' ? read(run, await cbs(effect[field])) : cbs(effect[field]));

  for (const condition of trigger.conditions.map(fields)) {
    if (condition.type === 'exists') {
      const wanted = await cbs(condition.value);
      const recent = run.messages.slice(-Number(condition.depth)).map((message) => message.data).join(' ');
      const found = condition.type2 === 'strict' ? recent.split(' ').includes(wanted) : condition.type2 === 'loose' ? recent.toLowerCase().includes(wanted.toLowerCase()) : condition.type2 !== 'regex' || new RegExp(wanted).test(recent);
      if (!found) return;
    } else if (condition.type === 'var' || condition.type === 'chatindex' || condition.type === 'value') {
      const value = await cbs(condition.type === 'var' ? read(run, text(condition.var)) : condition.type === 'chatindex' ? run.messages.length : condition.var);
      if (CONDITION.get(text(condition.operator))?.(value, await cbs(condition.value)) === false) return;
    }
  }

  const effects = trigger.effects.map(fields);
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index]!;
    const type = text(effect.type);
    switch (type) {
      case 'v2Header':
      case 'v2Comment':
      case 'v2EndIndent':
        break;
      case 'setvar':
      case 'v2SetVar': {
        const value = await operand(effect, 'value');
        const name = await cbs(effect.var);
        const made = effect.operator === '=' ? value : ARITHMETIC.get(text(effect.operator))?.(Number(read(run, name)) || 0, Number(value));
        if (made !== undefined) write(run, name, made);
        break;
      }
      case 'v2If':
      case 'v2IfAdvanced': {
        // v2If has no sourceType: its source is always a variable's name.
        const source = type === 'v2If' ? read(run, await cbs(effect.source)) : await operand(effect, 'source');
        if (COMPARE.get(text(effect.condition))?.(source, await operand(effect, 'target'))) break;
        // A failed if goes on after its block, and into the else that follows it, past the else's own line.
        index = closing(effects, index, Number(effect.indent) + 1);
        const next = effects[index + 1];
        if (next?.type === 'v2Else' && next.indent === effect.indent) index++;
        break;
      }
      // Reached only after an if that passed, since a failed one steps past this line.
      case 'v2Else':
        index = closing(effects, index, Number(effect.indent) + 1);
        break;
      case 'impersonate':
      case 'v2Impersonate': {
        const value = await operand(effect, 'value');
        if (effect.role === 'user' || effect.role === 'char') add(run, effect.role, value);
        break;
      }
      case 'modifychat':
      case 'v2ModifyChat': {
        const message = run.messages[Number(await operand(effect, 'index'))];
        const value = await operand(effect, 'value');
        if (message) message.data = value;
        break;
      }
      case 'cutchat':
      case 'v2CutChat': {
        const start = Number(await operand(effect, 'start'));
        const end = Number(await operand(effect, 'end'));
        run.messages = run.messages.slice(Number.isNaN(start) ? 0 : start, Number.isNaN(end) ? undefined : end);
        break;
      }
      case 'showAlert': {
        const value = await cbs(effect.value);
        const kind = effect.alertType;
        if (kind === 'normal' || kind === 'error') run.host.say(kind, value);
        else if (kind === 'input') write(run, await cbs(effect.inputVar), (await run.host.ask({ kind, text: value })) ?? '');
        else if (kind === 'select') write(run, await cbs(effect.inputVar), (await run.host.ask({ kind, options: value.split('§') })) ?? '');
        break;
      }
      case 'stop':
        run.stop = true;
        break;
      case 'extractRegex': {
        const found = new RegExp(text(effect.regex), text(effect.flags)).exec(await cbs(effect.value));
        write(run, text(effect.inputVar), text(effect.result).replace(/\$(\d+|&|\$)/g, (_, group: string) => (group === '$' ? '$' : (found?.[group === '&' ? 0 : Number(group)] ?? ''))));
        break;
      }
      default:
        run.missing.add(type);
    }
  }
}
