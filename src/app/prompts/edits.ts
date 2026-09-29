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

// A mark is on one text at most, so marking a text takes it off the one that had it (taken).
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

// Changing a key rewrites its conditions; changing only the label never touches them.
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

// What 조건 넣기 puts in place of the selection: selected text becomes the first branch, not replaced by it.
// select: the placeholder to type over next, the first branch's or, after a selection, the second's.
export function conditionSnippet(toggle: Toggle, selected: string): { text: string; select: [number, number] } {
  const branches =
    toggle.kind === 'check'
      ? [
          { open: `{{#when::toggle::${toggle.key}}}`, body: '켰을 때 글', close: '' },
          { open: '{{:else}}', body: '껐을 때 글', close: '{{/when}}' },
        ]
      : toggle.options.map((option, index) => ({ open: `{{#when::${toggle.key}::tis::${index}}}`, body: `${option}일 때 글`, close: '{{/when}}' }));
  const target = selected ? 1 : 0;
  let text = '';
  let select: [number, number] | null = null;
  for (const [index, { open, body, close }] of branches.entries()) {
    const words = index === 0 && selected ? selected : body;
    text += open;
    if (index === target) select = [text.length, text.length + words.length];
    text += words + close;
  }
  return { text, select: select ?? [text.length, text.length] };
}
