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
// The effects that read their operands and may write one variable, each by its Risu name with the fields it reads as
// operands in order: lua/blocks runs each by this name. The array and dictionary ones that take no var operand name
// their variable in var.
const CALLS = {
  v2ConcatString: ['source1', 'source2'],
  v2ReplaceString: ['source', 'regex', 'result', 'replacement', 'flags'],
  v2Calculate: ['expression'],
  v2Random: ['min', 'max'],
  v2GetCharAt: ['source', 'index'],
  v2GetCharCount: ['source'],
  v2ToLowerCase: ['source'],
  v2ToUpperCase: ['source'],
  v2SetCharAt: ['source', 'index', 'value'],
  v2SplitString: ['source', 'delimiter'],
  v2ExtractRegex: ['value', 'regex', 'flags', 'result'],
  v2RegexTest: ['value', 'regex', 'flags'],
  v2JoinArrayVar: ['var', 'delimiter'],
  v2GetDictVar: ['var', 'key'],
  v2HasDictKey: ['var', 'key'],
  v2GetDictSize: ['var'],
  v2GetDictKeys: ['var'],
  v2GetDictValues: ['var'],
  v2MakeArrayVar: [],
  v2GetArrayVarLength: [],
  v2GetArrayVar: ['index'],
  v2SetArrayVar: ['index', 'value'],
  v2PushArrayVar: ['value'],
  v2PopArrayVar: [],
  v2ShiftArrayVar: [],
  v2UnshiftArrayVar: ['value'],
  v2SpliceArrayVar: ['start', 'item'],
  v2SliceArrayVar: ['start', 'end'],
  v2GetIndexOfValueInArrayVar: ['value'],
  v2RemoveIndexFromArrayVar: ['index'],
  v2MakeDictVar: [],
  v2ClearDict: [],
  v2SetDictVar: ['key', 'value'],
  v2DeleteDictKey: ['key'],
  v2GetLastMessage: [],
  v2GetLastUserMessage: [],
  v2GetLastCharMessage: [],
  v2GetMessageAtIndex: ['index'],
  v2GetMessageCount: [],
  v2GetFirstMessage: [],
  v2QuickSearchChat: ['value', 'depth'],
  v2GetCharacterDesc: [],
  v2GetPersonaDesc: [],
  v2GetAuthorNote: [],
  v2GetLorebook: ['target'],
  v2GetLorebookByName: ['name'],
  v2GetLorebookByIndex: ['index'],
  v2GetLorebookIndexViaName: ['name'],
  v2GetAllLorebooks: [],
  v2GetLorebookCount: [],
  v2ShowAlert: ['value'],
  v2GetAlertInput: ['display'],
  v2GetAlertSelect: ['display', 'value'],
  v2RunLLM: ['value'],
  v2CheckSimilarity: ['source', 'value'],
  v2Tokenize: ['value'],
  v2Wait: ['value'],
} satisfies Record<string, string[]>;
export type CallType = keyof typeof CALLS;
// Risu's legacy entry reads, which index the lorebook as its tuples once did, and V1's effects named for what V2's do.
const SAME: Record<string, CallType> = { v2GetLorebookEntry: 'v2GetLorebookByIndex', v2GetLorebookCountNew: 'v2GetLorebookCount', runLLM: 'v2RunLLM', checkSimilarity: 'v2CheckSimilarity' };
const OPTIONS: Partial<Record<CallType, string>> = { v2QuickSearchChat: 'condition', v2RunLLM: 'model', v2SplitString: 'delimiterType' };
// A loop and a local variable need the end of their block, which a copy stored before they ran lost (reparsed).
const STRUCTURAL = new Set(['v2Loop', 'v2LoopNTimes', 'v2BreakLoop', 'v2DeclareLocalVar']);

export type BlockEffect =
  | { kind: 'noop' }
  | { kind: 'set'; name: string; operator: 'set' | 'add' | 'subtract' | 'multiply' | 'divide' | 'remainder' | null; value: Operand }
  // A variable of the block it is declared in, which hides a chat variable of that name until the block ends.
  | { kind: 'local'; name: string; value: Operand; indent: number }
  | { kind: 'if'; source: Operand; target: Operand; comparison: Comparison | null; otherwise: number }
  | { kind: 'else'; next: number }
  // end: the place of the line closing its body, or the trigger's length when none does. times: null runs until a
  // break.
  | { kind: 'loop'; times: Operand | null; end: number }
  | { kind: 'repeat'; loop: number; indent: number }
  | { kind: 'break'; loop: number; end: number }
  | { kind: 'close'; indent: number }
  | { kind: 'add'; role: 'user' | 'char' | null; value: Operand }
  | { kind: 'modify'; index: Operand; value: Operand }
  | { kind: 'cut'; start: Operand; end: Operand }
  | { kind: 'alert'; tone: 'normal' | 'error' | 'input' | 'select' | null; value: string; input: string }
  | { kind: 'stop' }
  | { kind: 'end' }
  | { kind: 'extract'; regex: string; flags: string; value: string; input: string; result: string }
  | { kind: 'trigger'; name: Operand }
  | { kind: 'reload' }
  // name: the variable an array or dictionary effect changes. option: the one field an effect reads as it is.
  | { kind: 'call'; type: CallType; inputs: Operand[]; name: string; output: string; option: string }
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
  const loops = effects.flatMap((effect, index) => (effect.type === 'v2Loop' || effect.type === 'v2LoopNTimes' ? [index] : []));
  // The end of a loop's body repeats it, whatever its endOfLoop says.
  const repeats = new Map(loops.map((loop) => [closing[loop]!, loop]));
  return effects.map((effect, index): BlockEffect => {
    const type = text(effect.type);
    const indent = Number(effect.indent) || 0;
    switch (type) {
      case 'v2Header': case 'v2Comment': case 'v2ConsoleLog': return { kind: 'noop' };
      case 'v2EndIndent': {
        const loop = repeats.get(index);
        return loop === undefined ? { kind: 'close', indent } : { kind: 'repeat', loop, indent };
      }
      case 'setvar': case 'v2SetVar': return { kind: 'set', name: text(effect.var), operator: ARITHMETIC.get(text(effect.operator)) ?? null, value: operand(effect, 'value') };
      case 'v2DeclareLocalVar': return { kind: 'local', name: text(effect.var), value: operand(effect, 'value'), indent };
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
      case 'v2Loop': case 'v2LoopNTimes': return { kind: 'loop', times: type === 'v2Loop' ? null : operand(effect, 'value'), end: closing[index]! };
      case 'v2BreakLoop': {
        const loop = loops.findLast((loop) => loop < index && index < closing[loop]!);
        return loop === undefined ? { kind: 'noop' } : { kind: 'break', loop, end: closing[loop]! };
      }
      case 'impersonate': case 'v2Impersonate': return { kind: 'add', role: effect.role === 'user' || effect.role === 'char' ? effect.role : null, value: operand(effect, 'value') };
      case 'modifychat': case 'v2ModifyChat': return { kind: 'modify', index: operand(effect, 'index'), value: operand(effect, 'value') };
      case 'cutchat': case 'v2CutChat': return { kind: 'cut', start: operand(effect, 'start'), end: operand(effect, 'end') };
      case 'showAlert': return { kind: 'alert', tone: effect.alertType === 'normal' || effect.alertType === 'error' || effect.alertType === 'input' || effect.alertType === 'select' ? effect.alertType : null, value: text(effect.value), input: text(effect.inputVar) };
      case 'stop': case 'v2StopPromptSending': return { kind: 'stop' };
      case 'v2StopTrigger': return { kind: 'end' };
      case 'extractRegex': return { kind: 'extract', regex: text(effect.regex), flags: text(effect.flags), value: text(effect.value), input: text(effect.inputVar), result: text(effect.result) };
      case 'runtrigger': return { kind: 'trigger', name: operand(effect, 'value') };
      case 'v2RunTrigger': return { kind: 'trigger', name: operand(effect, 'target') };
      case 'v2UpdateGUI': case 'v2UpdateChatAt': return { kind: 'reload' };
      default: {
        const call = SAME[type] ?? (Object.hasOwn(CALLS, type) ? (type as CallType) : null);
        if (call === null) return { kind: 'opaque', type, raw: raw[index] };
        const option = OPTIONS[call];
        // V1's effects name their output inputVar.
        return { kind: 'call', type: call, inputs: CALLS[call].map((field) => operand(effect, field)), name: text(effect.var), output: text(effect.outputVar ?? effect.inputVar), option: option ? text(effect[option]) : '' };
      }
    }
  });
}

// Effects stored opaque before this app ran their type, read again from the source each kept. A loop and a local
// variable stay opaque: they need the end of their block, and the copy lost that line's indent.
export function reparsed(effects: BlockEffect[]): BlockEffect[] | null {
  let changed = false;
  const read = effects.map((effect) => {
    if (effect.kind !== 'opaque' || STRUCTURAL.has(effect.type)) return effect;
    const again = blockEffects([effect.raw])[0]!;
    changed ||= again.kind !== 'opaque';
    return again;
  });
  return changed ? read : null;
}
