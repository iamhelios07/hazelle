import type { Block, Prompt, Role, SlotKind, TextBlock, Toggle } from '../../model/prompt';
import type { PromptPatch } from '../../runtime/prompts';
import { blockSource } from './blocks';
import { renameToggle, toggleUses } from './rekey';

export type Draft = Pick<Prompt, 'name' | 'blocks' | 'toggles' | 'authorNote'>;
export const draftOf = ({ name, blocks, toggles, authorNote }: Prompt): Draft => ({ name, blocks, toggles, authorNote });

export type NewBlock = { text: Role } | { slot: SlotKind };

export function newBlock(kind: NewBlock): Block {
  const named = { id: crypto.randomUUID(), name: null };
  if ('text' in kind) return { ...named, kind: 'text', role: kind.text, text: '', mark: null };
  switch (kind.slot) {
    case 'description':
    case 'persona':
    case 'authorNote':
      return { ...named, kind: 'slot', slot: kind.slot, role: 'system', wrapper: null };
    case 'chat':
      return { ...named, kind: 'slot', slot: 'chat', range: { from: 0, to: null } };
    default:
      return { ...named, kind: 'slot', slot: kind.slot };
  }
}

export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

// A mark is on one text at most (design §4.2: the main text and the global note a card overrides); marking a text
// takes it off the one that had it. taken: that one's id.
export function withMark(blocks: readonly Block[], id: string, mark: TextBlock['mark']): { blocks: Block[]; taken: string | null } {
  let taken: string | null = null;
  const next = blocks.map((block) => {
    if (block.kind !== 'text') return block;
    if (block.id === id) return { ...block, mark };
    if (mark !== null && block.mark === mark) {
      taken = block.id;
      return { ...block, mark: null };
    }
    return block;
  });
  return { blocks: next, taken };
}

// Every text a condition can stand in: text blocks, 감싸는 글 and the default 작가의 노트.
function rewrite(draft: Draft, change: (text: string) => string): Pick<Draft, 'blocks' | 'authorNote'> {
  return {
    blocks: draft.blocks.map((block) => {
      if (block.kind === 'text') return { ...block, text: change(block.text) };
      if ('wrapper' in block && block.wrapper !== null) return { ...block, wrapper: change(block.wrapper) };
      return block;
    }),
    authorNote: change(draft.authorNote),
  };
}

export const countUses = (draft: Draft, key: string) =>
  [...draft.blocks.map(blockSource), draft.authorNote].reduce((count, text) => count + toggleUses(text).filter((use) => use.key === key).length, 0);

// design §4.2: changing a key rewrites its conditions; changing only the label never touches them.
export function rekey(draft: Draft, from: string, to: string): PromptPatch {
  return { ...rewrite(draft, (text) => renameToggle(text, from, to)), toggles: draft.toggles.map((toggle) => (toggle.key === from ? { ...toggle, key: to } : toggle)) };
}

// Why a key cannot be used, or null. A key stands inside {{#when::toggle::KEY}}, so it holds none of CBS's own marks.
export function keyProblem(key: string, toggles: readonly Toggle[], own: string | null): string | null {
  if (!key) return '조건에서 부르는 이름을 적어 주세요.';
  if (/[\s:{}]/.test(key)) return '빈칸과 :, {, }는 쓸 수 없어요.';
  if (key !== own && toggles.some((toggle) => toggle.key === key)) return '이미 쓰는 이름이에요.';
  return null;
}

// What 조건 넣기 puts at the caret, with the first branch's words selected so typing replaces them.
export function conditionSnippet(toggle: Toggle): { text: string; select: [number, number] } {
  if (toggle.kind === 'check') {
    const head = `{{#when::toggle::${toggle.key}}}`;
    const on = '켰을 때 글';
    return { text: `${head}${on}{{:else}}껐을 때 글{{/when}}`, select: [head.length, head.length + on.length] };
  }
  const heads = toggle.options.map((option, index) => ({ head: `{{#when::${toggle.key}::tis::${index}}}`, body: `${option}일 때 글` }));
  const first = heads[0];
  return {
    text: heads.map(({ head, body }) => `${head}${body}{{/when}}`).join(''),
    select: first ? [first.head.length, first.head.length + first.body.length] : [0, 0],
  };
}
