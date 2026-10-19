import { blockHead, conditionSteps, isBlockName, isProse, isRawBlock, separatorOf, whenArgs } from '../../../engine/cbs/evaluate';
import { parse, type Block, type Legacy, type Node, type Tag } from '../../../engine/cbs/parse';
import { handlerFor, isUnsupportedTag, normalize } from '../../../engine/cbs/tags';
import type { CodeCompletion, CodeDoc, CodeItem, CodeLanguage, CodeProblem, CodeSpan } from '../../ui';
import { particleOf, withParticle } from '../particles';
import { COMMANDS, type Command } from './cbsCommands';
import { nearest } from './nearest';
import { variableDoc, variableItems, type Defaults } from './variables';

// Text one field puts in before CBS runs: a card's instructions take {{original}} (pipeline.ts), a regex's
// replacement {{data}} (regex/scripts.ts).
export type CbsPlaceholder = 'original' | 'data';
const PLACEHOLDERS: Record<CbsPlaceholder, string> = {
  original: '이 칸이 대신하는 프롬프트 텍스트가 그 자리에 들어가요.',
  data: '패턴이 찾은 텍스트 전체가 그 자리에 들어가요.',
};

const headOf = (form: string) => /^\{\{([#/]?[^:}\s]+|:)/.exec(form)![1]!;
const ENTRIES = COMMANDS.flatMap((group) => group.commands.map((command) => ({ command, group: group.title, head: headOf(command.form) })));
// By normalized name; a block by its head, `#when`.
const BY_NAME = new Map<string, Command>();
for (const { command, head } of ENTRIES) for (const name of command.names.length ? command.names : [head]) BY_NAME.set(head.startsWith('#') ? head : normalize(name), command);
const BLOCK_HEADS = ENTRIES.filter(({ head }) => head.startsWith('#')).map(({ head }) => head.slice(1));
const NAMES = ENTRIES.flatMap(({ command, head }) => (command.names.length ? command.names : head.startsWith('#') ? [] : [head]));
const VARIABLE_TAGS = new Set(['getvar', 'setvar', 'addvar', 'setdefaultvar']);

// A form's words become tab stops: `{{getvar::이름}}` → `getvar::${1:이름}}}${0}`, written after the `{{` typed.
export function formTemplate(form: string) {
  let stop = 0;
  const field = (word: string) => `\${${++stop}:${word.replace(/[{}]/g, '')}}`;
  const body = form.replace(/\{\{([^{}]*)\}\}|([^{}]+)/g, (_, tag: string | undefined, text: string | undefined) => {
    if (tag === undefined) return field(text!);
    const [head, ...args] = tag.split('::');
    const space = head!.indexOf(' ');
    const name = space < 0 ? head : `${head!.slice(0, space)} ${field(head!.slice(space + 1))}`;
    return `{{${[name, ...args.map(field)].join('::')}}}`;
  });
  return `${body.slice(2)}\${0}`;
}

function commandDoc(command: Command): CodeDoc {
  const facts: [string, string][] = [];
  if (command.example) facts.push(['예', `${command.example[0]} → ${command.example[1]}`]);
  if (command.names.length > 1) facts.push(['다른 이름', command.names.slice(1).join(', ')]);
  return { form: command.form, text: command.what, facts };
}

// A tag as written. name: as written and trimmed, from nameAt; null when a tag inside it makes it. value: where its
// first argument stands.
type Found = { from: number; to: number; name: string | null; nameAt: number; value: { from: number; to: number } | null };
type Reading = { spans: CodeSpan[]; problems: CodeProblem[]; tags: Found[] };

function read(text: string, known: (name: string) => boolean): Reading {
  const spans: CodeSpan[] = [];
  const problems: CodeProblem[] = [];
  const tags: Found[] = [];
  const span = (from: number, to: number, kind: CodeSpan['kind']) => {
    if (to > from) spans.push({ from, to, kind });
  };
  const problem = (from: number, to: number, severity: CodeProblem['severity'], message: string, fix?: CodeProblem['fix']) => problems.push({ from, to, severity, message, ...(fix && { fix }) });

  // The nodes on one level, from at; block: the name of the block they are the body of.
  const level = (nodes: Node[], at: number, block: string | null) => {
    for (const node of nodes) {
      if (typeof node === 'string') {
        // Only an unclosed `{{` is left in text: parse reads every other one as a tag.
        for (let found = node.indexOf('{{'); found !== -1; found = node.indexOf('{{', found + 2)) problem(at + found, at + found + 2, 'warning', '짝이 되는 }}가 없어서 글자 그대로 들어가요.');
        at += node.length;
      } else {
        visit(node, block);
        at = node.kind === 'block' ? node.close.end : node.end;
      }
    }
  };

  const visit = (node: Exclude<Node, string>, block: string | null) => {
    if (node.kind === 'legacy') return legacy(node);
    if (node.kind === 'block') return blockOf(node);
    const found = tag(node);
    if (!found?.name) return;
    const { name } = found;
    const word = normalize(name);
    if (name.startsWith('#')) problem(node.at, node.end, 'error', `블록을 닫는 {{/${name.slice(1)}}} 태그가 없어요.`);
    else if (name.startsWith('/')) problem(node.at, node.end, 'error', '열린 블록 없이 닫는 태그예요.');
    else if (name === ':else') {
      if (block !== 'when') problem(node.at, node.end, 'warning', '{{:else}}는 #when 블록 안에서만 써요.');
    } else if (name === '?' || known(name)) return;
    else if (isUnsupportedTag(word)) problem(node.at, node.end, 'warning', '헤이젤에 없는 명령어라 적은 그대로 남아요.');
    else if (!isProse(word)) unknown(name, found, NAMES);
  };

  const unknown = (name: string, { nameAt }: Found, pool: readonly string[]) => {
    const near = nearest(name.replace(/^#/, ''), pool, normalize);
    const at = name.startsWith('#') ? nameAt + 1 : nameAt;
    const to = nameAt + name.length;
    if (near) problem(at, to, 'warning', `${near}의 오타 같아요.`, { label: `${withParticle(near, '으로/로')} 바꾸기`, insert: near });
    else problem(at, to, 'warning', '모르는 명령어라 적은 그대로 남아요.');
  };

  const blockOf = (node: Block) => {
    const head = tag(node.head);
    const name = head?.name ? normalize(head.name.slice(1)) : null;
    if (head?.name && name !== null) {
      if (!isBlockName(name) && !isProse(name)) unknown(head.name, head, BLOCK_HEADS);
      const whole = node.head.parts.every((part) => typeof part === 'string') ? node.head.parts.join('') : null;
      if (name === 'when' && whole !== null) {
        const { condition } = whenArgs(blockHead(whole)!.rest);
        if (condition.length === 0 || !conditionSteps(condition).valid) problem(node.head.at, node.head.end, 'warning', '조건을 읽을 수 없어서 늘 아닐 때 쪽이 들어가요.');
      }
    }
    // A raw block's body is text, whatever it holds.
    if (name === null || !isRawBlock(name)) level(node.body, node.head.end, name);
    const close = tag(node.close);
    const shut = close?.name ? normalize(close.name.slice(1)) : '';
    if (head?.name && name !== null && shut && shut !== name) {
      const written = head.name.slice(1);
      problem(node.close.at, node.close.end, 'warning', `#${written} 블록을 닫는 태그예요.`, { label: `/${written}${particleOf(written, '으로/로')} 바꾸기`, insert: `{{/${written}}}` });
    }
  };

  const legacy = (node: Legacy) => {
    span(node.at, node.at + 2, 'tag');
    parts(node.parts, node.at + 2, '::');
    span(node.end - 2, node.end, 'tag');
  };

  // The tag's spans and what it is; null for a comment.
  const tag = (node: Tag): Found | null => {
    const lead = typeof node.parts[0] === 'string' ? node.parts[0] : '';
    if (lead.startsWith('//')) {
      span(node.at, node.end, 'comment');
      return null;
    }
    const whole = node.parts.length === 1 ? lead : null;
    if (whole === 'slot') {
      span(node.at, node.end, 'slot');
      tags.push({ from: node.at, to: node.end, name: 'slot', nameAt: node.at + 2, value: null });
      return tags.at(-1)!;
    }
    const skip = lead.length - lead.trimStart().length;
    const rest = lead.slice(skip);
    const length = /^[#/]/.test(rest) ? /^[#/][^\s:]*/.exec(rest)![0].length : /^:(else)?\s*$/.test(rest) ? rest.trimEnd().length : rest.startsWith('? ') ? 1 : rest.indexOf(':') !== -1 ? rest.indexOf(':') : whole !== null ? rest.trimEnd().length : -1;
    const partial = length === -1 || (skip + length === lead.length && node.parts.length > 1);
    const nameTo = node.at + 2 + skip + Math.max(length, 0);
    const found: Found = { from: node.at, to: node.end, name: partial ? null : rest.slice(0, length).trimEnd(), nameAt: node.at + 2 + skip, value: null };
    tags.push(found);
    span(node.at, partial ? node.at + 2 : nameTo, 'tag');
    const separator = separatorOf(lead) ?? '::';
    const first = partial ? node.parts : [lead.slice(skip + length), ...node.parts.slice(1)];
    found.value = parts(first, partial ? node.at + 2 : nameTo, separator);
    span(node.end - 2, node.end, 'tag');
    return found;
  };

  // A tag's parts after its name: separators, arguments and the tags inside. Gives where its first argument stands.
  const parts = (nodes: Node[], at: number, separator: string) => {
    let value: { from: number; to: number } | null = null;
    let open: number | null = null;
    for (const node of nodes) {
      if (typeof node !== 'string') {
        visit(node, null);
        at = node.kind === 'block' ? node.close.end : node.end;
        continue;
      }
      let from = 0;
      for (let cut = node.indexOf(separator); ; cut = node.indexOf(separator, cut + separator.length)) {
        const to = cut === -1 ? node.length : cut;
        span(at + from, at + to, 'argument');
        if (open !== null && value === null && cut !== -1) value = { from: open, to: at + to };
        if (cut === -1) break;
        span(at + cut, at + cut + separator.length, 'separator');
        if (open === null) open = at + cut + separator.length;
        from = cut + separator.length;
      }
      at += node.length;
    }
    return value ?? (open === null ? null : { from: open, to: at });
  };

  level(parse(text), 0, null);
  return { spans: spans.sort((a, b) => a.from - b.from), problems, tags };
}

// The innermost block still open where a `{{/` is typed, as written: parse reads an unclosed block's head as a lone
// tag at the top, in order.
function openBlock(before: string): string | null {
  const heads = parse(before).filter((node): node is Tag => typeof node !== 'string' && node.kind === 'tag' && typeof node.parts[0] === 'string' && node.parts[0].trimStart().startsWith('#'));
  const head = heads.at(-1)?.parts[0] as string | undefined;
  return head === undefined ? null : /^#([^\s:]*)/.exec(head.trimStart())![1]! || null;
}

const writtenNames = (text: string) => [...text.matchAll(/\{\{\s*(?:setvar|addvar|setdefaultvar)::([^:{}]+)/gi)].map((found) => found[1]!);

// variables: the character's 기본 변수, offered and explained by name. placeholder: the field's own, when it has one.
export function cbsLanguage({ variables = [], placeholder }: { variables?: Defaults; placeholder?: CbsPlaceholder } = {}): CodeLanguage {
  const known = (name: string) => handlerFor(name) !== undefined || BY_NAME.has(normalize(name)) || (placeholder !== undefined && normalize(name) === placeholder);
  let last: { text: string; reading: Reading } | null = null;
  const reading = (text: string) => (last?.text === text ? last.reading : (last = { text, reading: read(text, known) }).reading);
  const items: CodeItem[] = [
    ...ENTRIES.map(({ command, group, head }): CodeItem => ({ label: head, kind: head.startsWith('#') ? 'keyword' : 'function', detail: group, template: formTemplate(command.form), closing: '}}', ...(command.uses && { boost: 1 }), doc: commandDoc(command) })),
    ...(placeholder ? [{ label: placeholder, kind: 'variable', detail: '이 칸', template: `${placeholder}}}\${0}`, closing: '}}', boost: 2, doc: { form: `{{${placeholder}}}`, text: PLACEHOLDERS[placeholder] } } satisfies CodeItem] : []),
  ];

  const complete = (text: string, at: number): CodeCompletion | null => {
    const before = text.slice(0, at);
    const slot = /\{\{\s*(?:getvar|setvar|addvar|setdefaultvar)::([^:{}]*)$/i.exec(before);
    if (slot) {
      const from = at - slot[1]!.length;
      // The name being typed is no name the text has yet.
      return { from, items: variableItems(variables, writtenNames(text.slice(0, from) + text.slice(at))), validFor: /^[^:{}]*$/ };
    }
    const word = /\{\{([#/]?[\w가-힣?-]*)$/.exec(before);
    if (!word) return null;
    const from = at - word[1]!.length;
    const block = word[1]!.startsWith('/') ? openBlock(text.slice(0, from - 2)) : null;
    const close: CodeItem[] = block ? [{ label: `/${block}`, kind: 'keyword', detail: `#${block} 닫기`, template: `/${block}}}\${0}`, closing: '}}', boost: 99 }] : [];
    return { from, items: [...close, ...items], validFor: /^[#/]?[\w가-힣?-]*$/ };
  };

  const explain = (text: string, at: number) => {
    const found = reading(text).tags.findLast((tag) => tag.from <= at && at <= tag.to);
    if (!found?.name) return null;
    const word = normalize(found.name);
    if (VARIABLE_TAGS.has(word) && found.value && found.value.from <= at && at <= found.value.to) {
      const name = text.slice(found.value.from, found.value.to);
      return name.includes('{{') ? null : { from: found.from, to: found.to, doc: variableDoc(name, variables) };
    }
    if (placeholder && word === placeholder) return { from: found.from, to: found.to, doc: { form: `{{${placeholder}}}`, text: PLACEHOLDERS[placeholder] } };
    const command = found.name.startsWith('#') || found.name.startsWith('/') ? BY_NAME.get(`#${found.name.slice(1).toLowerCase()}`) : (BY_NAME.get(word) ?? (found.name === '?' ? BY_NAME.get('calc') : undefined));
    return command ? { from: found.from, to: found.to, doc: commandDoc(command) } : null;
  };

  return {
    syntax: (text) => reading(text).spans,
    comment: { open: '{{// ', close: '}}' },
    lint: (text) => reading(text).problems,
    complete: (text, at) => complete(text, at),
    explain,
  };
}
