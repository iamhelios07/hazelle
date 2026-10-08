import type { Comparison, Operand } from '../import/blocks';
import type { Trigger } from '../import/types';
import { add, cbs as evaluated, read, write, type Acting } from './state';

export type Blocks = Omit<Extract<Trigger, { kind: 'blocks' }>, 'id' | 'off'>;
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

// Trigger conditions compare equality as text; v2 branches compare numerically when both texts are numbers.
const COMPARE: Record<Comparison['operator'], (source: string, target: string, equality: Comparison['equality']) => boolean> = {
  equal: (source, target, equality) => equality === 'numeric' ? same(source, target) : source === target,
  unequal: (source, target, equality) => equality === 'numeric' ? !same(source, target) : source !== target,
  greater: (source, target) => Number(source) > Number(target),
  less: (source, target) => Number(source) < Number(target),
  'at-least': (source, target) => Number(source) >= Number(target),
  'at-most': (source, target) => Number(source) <= Number(target),
  truthy: isTrue,
  unset: (source) => source === 'null',
  in: (source, target) => holds(target, source),
  contains: (source, target) => holds(source, target),
  'not-in': (source, target) => !holds(target, source),
  'not-contains': (source, target) => !holds(source, target),
  near: (source, target) => numbers(source, target) ? Math.abs(Number(source) - Number(target)) < 0.0001 : source.toLowerCase().replaceAll(' ', '') === target.toLowerCase().replaceAll(' ', ''),
  'same-truth': (source, target) => target === 'true' ? isTrue(source) : target === 'false' ? !isTrue(source) : source === target,
};
const compare = ({ operator, equality }: Comparison, source: string, target: string) => COMPARE[operator](source, target, equality);
const ARITHMETIC = {
  add: (had: number, by: number) => had + by,
  subtract: (had: number, by: number) => had - by,
  multiply: (had: number, by: number) => had * by,
  divide: (had: number, by: number) => had / by,
  remainder: (had: number, by: number) => had % by,
};

// Only effects the surveyed bots use execute (docs/research/bot-survey.md); opaque effects do nothing and are named
// in run.missing, as a Lua function this app lacks is. Conditions and effect operands evaluate CBS at execution.
export async function runBlocks(trigger: Blocks, run: Acting): Promise<void> {
  const cbs = (value: string) => evaluated(run, value);
  const operand = (value: Operand) => value.kind === 'variable' ? read(run, cbs(value.name)) : cbs(value.text);
  for (const condition of trigger.conditions) {
    if (condition.kind === 'exists') {
      const wanted = cbs(condition.value);
      const recent = condition.depth === null ? '' : run.messages.slice(-condition.depth).map((message) => message.data).join(' ');
      const found = condition.match === 'strict' ? recent.split(' ').includes(wanted) : condition.match === 'loose' ? recent.toLowerCase().includes(wanted.toLowerCase()) : condition.match !== 'regex' || new RegExp(wanted).test(recent);
      if (!found) return;
    } else if (condition.kind === 'compare' || condition.kind === 'probe') {
      // Conditions evaluate the variable's value as CBS, not its name; effect operands do the opposite.
      const { source } = condition;
      const value = cbs(source.kind === 'variable' ? read(run, source.name) : source.kind === 'length' ? String(run.messages.length) : source.text);
      if (condition.kind === 'compare' && !compare(condition.comparison, value, cbs(condition.value))) return;
    }
  }
  const effects = trigger.effects;
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index]!;
    switch (effect.kind) {
      case 'noop': break;
      case 'set': {
        const value = operand(effect.value);
        const name = cbs(effect.name);
        const made = effect.operator === 'set' ? value : effect.operator === null ? undefined : ARITHMETIC[effect.operator](Number(read(run, name)) || 0, Number(value));
        if (made !== undefined) write(run, name, made);
        break;
      }
      case 'if': {
        const source = operand(effect.source);
        if (!effect.comparison || !compare(effect.comparison, source, operand(effect.target))) index = effect.otherwise - 1;
        break;
      }
      case 'else': index = effect.next - 1; break;
      case 'add': {
        const value = operand(effect.value);
        if (effect.role !== null) add(run, effect.role, value);
        break;
      }
      case 'modify': {
        const message = run.messages[Number(operand(effect.index))];
        const value = operand(effect.value);
        if (message) message.data = value;
        break;
      }
      case 'cut': {
        const start = Number(operand(effect.start));
        const end = Number(operand(effect.end));
        run.messages = run.messages.slice(Number.isNaN(start) ? 0 : start, Number.isNaN(end) ? undefined : end);
        break;
      }
      case 'alert': {
        const value = cbs(effect.value);
        const kind = effect.tone;
        if (kind === 'normal' || kind === 'error') run.host.say(kind, value);
        else if (kind === 'input') write(run, cbs(effect.input), (await run.host.ask({ kind, text: value })) ?? '');
        else if (kind === 'select') write(run, cbs(effect.input), (await run.host.ask({ kind, options: value.split('§') })) ?? '');
        break;
      }
      case 'stop': run.stop = true; break;
      case 'extract': {
        const found = new RegExp(effect.regex, effect.flags).exec(cbs(effect.value));
        write(run, effect.input, effect.result.replace(/\$(\d+|&|\$)/g, (_, group: string) => (group === '$' ? '$' : (found?.[group === '&' ? 0 : Number(group)] ?? ''))));
        break;
      }
      case 'opaque': run.missing.add(effect.type); break;
    }
  }
}
