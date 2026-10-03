import { isRecord, list } from '../../connectors/values';
import { text } from '../lua/state';

export type Operand = { kind: 'text'; text: string } | { kind: 'variable'; name: string };
type ConditionSource = Operand | { kind: 'length' };
export type Comparison = { operator: 'equal' | 'unequal' | 'greater' | 'less' | 'at-least' | 'at-most' | 'truthy' | 'unset' | 'in' | 'contains' | 'not-in' | 'not-contains' | 'near' | 'same-truth'; equality: 'text' | 'numeric' };
export type BlockCondition =
  | { kind: 'exists'; value: string; depth: number | null; match: 'strict' | 'loose' | 'regex' | null }
  | { kind: 'compare'; source: ConditionSource; comparison: Comparison; value: string }
  | { kind: 'probe'; source: ConditionSource }
  | { kind: 'opaque'; raw: unknown };
export type BlockEffect =
  | { kind: 'noop' }
  | { kind: 'set'; name: string; operator: 'set' | 'add' | 'subtract' | 'multiply' | 'divide' | 'remainder' | null; value: Operand }
  | { kind: 'if'; source: Operand; target: Operand; comparison: Comparison | null; otherwise: number }
  | { kind: 'else'; next: number }
  | { kind: 'add'; role: 'user' | 'char' | null; value: Operand }
  | { kind: 'modify'; index: Operand; value: Operand }
  | { kind: 'cut'; start: Operand; end: Operand }
  | { kind: 'alert'; tone: 'normal' | 'error' | 'input' | 'select' | null; value: string; input: string }
  | { kind: 'stop' }
  | { kind: 'extract'; regex: string; flags: string; value: string; input: string; result: string }
  | { kind: 'opaque'; type: string; raw: unknown };

// A condition or an effect as Risu wrote it comes from a bot's file, so every field is read as it may be.
type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => (isRecord(value) ? value : {});
// V2 operands say whether a field is text or the name of a variable. V1's untyped operands are texts.
const operand = (raw: Fields, field: string): Operand => raw[`${field}Type`] === 'var' ? { kind: 'variable', name: text(raw[field]) } : { kind: 'text', text: text(raw[field]) };
const RELATIONS: [string, Comparison['operator']][] = [['=', 'equal'], ['!=', 'unequal'], ['>', 'greater'], ['<', 'less'], ['>=', 'at-least'], ['<=', 'at-most']];
const CONDITIONS = new Map([...RELATIONS, ['true', 'truthy'], ['null', 'unset']] as [string, Comparison['operator']][]);
const BRANCHES = new Map([...RELATIONS, ['∈', 'in'], ['∋', 'contains'], ['∉', 'not-in'], ['∌', 'not-contains'], ['≒', 'near'], ['≡', 'same-truth']] as [string, Comparison['operator']][]);
const ARITHMETIC = new Map<string, Extract<BlockEffect, { kind: 'set' }>['operator']>([['=', 'set'], ['+=', 'add'], ['-=', 'subtract'], ['*=', 'multiply'], ['/=', 'divide'], ['%=', 'remainder']]);

export function blockConditions(values: unknown): BlockCondition[] {
  return list(values).map((value): BlockCondition => {
    const raw = fields(value);
    if (raw.type === 'exists') return { kind: 'exists', value: text(raw.value), depth: Number.isFinite(Number(raw.depth)) ? Number(raw.depth) : Number(raw.depth) === -Infinity ? null : 0, match: raw.type2 === 'strict' || raw.type2 === 'loose' || raw.type2 === 'regex' ? raw.type2 : null };
    if (raw.type !== 'var' && raw.type !== 'chatindex' && raw.type !== 'value') return { kind: 'opaque', raw: value };
    const source: ConditionSource = raw.type === 'var' ? { kind: 'variable', name: text(raw.var) } : raw.type === 'chatindex' ? { kind: 'length' } : { kind: 'text', text: text(raw.var) };
    const operator = CONDITIONS.get(text(raw.operator));
    // Unknown condition operators pass, but Risu still evaluates the left side's CBS, never the right side's.
    return operator ? { kind: 'compare', source, comparison: { operator, equality: 'text' }, value: text(raw.value) } : { kind: 'probe', source };
  });
}

export function blockEffects(values: unknown): BlockEffect[] {
  const raw = list(values);
  const effects = raw.map(fields);
  const ends = new Map<number, number>();
  const closing: number[] = [];
  // A v2EndIndent closes the block at its exact numeric indent. A missing end skips to the trigger's end.
  for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index]!;
    if (effect.type === 'v2EndIndent' && typeof effect.indent === 'number' && !Number.isNaN(effect.indent)) ends.set(effect.indent, index);
    closing[index] = ends.get(Number(effect.indent) + 1) ?? effects.length;
  }
  return effects.map((effect, index): BlockEffect => {
    const type = text(effect.type);
    switch (type) {
      case 'v2Header': case 'v2Comment': case 'v2EndIndent': return { kind: 'noop' };
      case 'setvar': case 'v2SetVar': return { kind: 'set', name: text(effect.var), operator: ARITHMETIC.get(text(effect.operator)) ?? null, value: operand(effect, 'value') };
      case 'v2If': case 'v2IfAdvanced': {
        const operator = BRANCHES.get(text(effect.condition));
        const end = closing[index]!;
        const next = effects[end + 1];
        // A failed if enters the following else past its header. v2If's source is always a variable's name, even if
        // a file supplies sourceType; only v2IfAdvanced reads that field.
        return { kind: 'if', source: type === 'v2If' ? { kind: 'variable', name: text(effect.source) } : operand(effect, 'source'), target: operand(effect, 'target'), comparison: operator ? { operator, equality: 'numeric' } : null, otherwise: end + (next?.type === 'v2Else' && next.indent === effect.indent ? 2 : 1) };
      }
      // Reached only after an if that passed, since a failed one steps past this line.
      case 'v2Else': return { kind: 'else', next: closing[index]! + 1 };
      case 'impersonate': case 'v2Impersonate': return { kind: 'add', role: effect.role === 'user' || effect.role === 'char' ? effect.role : null, value: operand(effect, 'value') };
      case 'modifychat': case 'v2ModifyChat': return { kind: 'modify', index: operand(effect, 'index'), value: operand(effect, 'value') };
      case 'cutchat': case 'v2CutChat': return { kind: 'cut', start: operand(effect, 'start'), end: operand(effect, 'end') };
      case 'showAlert': return { kind: 'alert', tone: effect.alertType === 'normal' || effect.alertType === 'error' || effect.alertType === 'input' || effect.alertType === 'select' ? effect.alertType : null, value: text(effect.value), input: text(effect.inputVar) };
      case 'stop': return { kind: 'stop' };
      case 'extractRegex': return { kind: 'extract', regex: text(effect.regex), flags: text(effect.flags), value: text(effect.value), input: text(effect.inputVar), result: text(effect.result) };
      default: return { kind: 'opaque', type, raw: raw[index] };
    }
  });
}
