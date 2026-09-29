import type { Block, ChatRange, ChatSlot, Role, TextBlock, Toggle, WrappedSlot } from '../../model/prompt';
import type { PromptPatch } from '../../runtime/prompts';
import { blockTitle, MARKS } from './blocks';
import { moved, rekey, withMark, type Draft } from './edits';

// One structural edit and its inverse. Both apply to the draft as it is then and change only what the edit changed,
// so text typed in between survives either way. Typing is not a step: a text field keeps the browser's own undo.
export type Step = {
  // What it did, as a toast names it.
  label: string;
  // The block to show once it is undone or redone.
  block: string | null;
  undo: (draft: Draft) => PromptPatch;
  redo: (draft: Draft) => PromptPatch;
};

export type History = { done: readonly Step[]; undone: readonly Step[] };
export const NO_HISTORY: History = { done: [], undone: [] };

export const recorded = (history: History, step: Step): History => ({ done: [...history.done, step], undone: [] });

// The last step done, or the one a toast's 되돌리기 names, moved to the undone; null when it is not there to undo.
export function undoing(history: History, step = history.done.at(-1)): { history: History; step: Step } | null {
  if (!step || !history.done.includes(step)) return null;
  return { step, history: { done: history.done.filter((each) => each !== step), undone: [...history.undone, step] } };
}

export function redoing(history: History): { history: History; step: Step } | null {
  const step = history.undone.at(-1);
  if (!step) return null;
  return { step, history: { done: [...history.done, step], undone: history.undone.slice(0, -1) } };
}

// Puts an item back where it stood, or takes it out, keeping it as it was when taken, typing included. Adding is put
// then take to undo, removing the other way round.
function presence<T>(item: T, at: number, same: (a: T, b: T) => boolean) {
  let kept = item;
  return {
    put: (items: readonly T[]) => [...items.slice(0, at), kept, ...items.slice(at)],
    take: (items: readonly T[]) => {
      kept = items.find((each) => same(each, kept)) ?? kept;
      return items.filter((each) => !same(each, kept));
    },
  };
}

const sameBlock = (a: Block, b: Block) => a.id === b.id;
const sameToggle = (a: Toggle, b: Toggle) => a.key === b.key;
const titled = (block: Block, what: string) => `‘${blockTitle(block).title}’ ${what}`;
const onBlock = (id: string, change: (block: Block) => Block) => (draft: Draft): PromptPatch => ({
  blocks: draft.blocks.map((each) => (each.id === id ? change(each) : each)),
});

export function addBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock);
  return { label: titled(block, '블록 넣기'), block: block.id, undo: (draft) => ({ blocks: take(draft.blocks) }), redo: (draft) => ({ blocks: put(draft.blocks) }) };
}

export function removeBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock);
  return { label: titled(block, '블록 빼기'), block: block.id, undo: (draft) => ({ blocks: put(draft.blocks) }), redo: (draft) => ({ blocks: take(draft.blocks) }) };
}

export function moveBlock(block: Block, from: number, to: number): Step {
  const place = (index: number) => (draft: Draft): PromptPatch => {
    const now = draft.blocks.findIndex((each) => each.id === block.id);
    return now === -1 ? {} : { blocks: moved(draft.blocks, now, index) };
  };
  return { label: titled(block, '블록 옮기기'), block: block.id, undo: place(from), redo: place(to) };
}

export function setRole(block: Extract<Block, { role: Role }>, role: Role): Step {
  const to = (value: Role) => onBlock(block.id, (each) => ('role' in each ? { ...each, role: value } : each));
  return { label: titled(block, '보내는 역할 바꾸기'), block: block.id, undo: to(block.role), redo: to(role) };
}

export function setRange(block: ChatSlot, range: ChatRange): Step {
  const to = (value: ChatRange) => onBlock(block.id, (each) => (each.kind === 'slot' && each.slot === 'chat' ? { ...each, range: value } : each));
  return { label: titled(block, '들어갈 메시지 바꾸기'), block: block.id, undo: to(block.range), redo: to(range) };
}

export function setCache(block: Block, on: boolean): Step {
  const to = (value: boolean) =>
    onBlock(block.id, (each) => {
      const next = { ...each };
      if (value) next.cache = true;
      else delete next.cache;
      return next;
    });
  return { label: titled(block, on ? '여기까지 캐시' : '캐시 지점 빼기'), block: block.id, undo: to(!on), redo: to(on) };
}

// Trades the 감싸는 글 there for the one the step holds, so one function is both ways: each apply puts back what the one
// before took out, text typed into it since included.
export function setWrapper(block: WrappedSlot, wrapper: string | null): Step {
  let held = wrapper;
  const trade = (draft: Draft): PromptPatch => {
    const now = draft.blocks.find((each) => each.id === block.id);
    if (!now || !('wrapper' in now)) return {};
    const next = held;
    held = now.wrapper;
    return onBlock(block.id, (each) => ('wrapper' in each ? { ...each, wrapper: next } : each))(draft);
  };
  return { label: titled(block, wrapper === null ? '감싸는 글 빼기' : '감싸는 글 넣기'), block: block.id, undo: trade, redo: trade };
}

// taken: the text withMark took the mark from, which undoing gives it back to.
export function setMark(block: TextBlock, mark: TextBlock['mark'], taken: string | null): Step {
  const was = block.mark;
  const undo = (draft: Draft): PromptPatch => ({
    blocks: draft.blocks.map((each) => (each.kind !== 'text' ? each : each.id === block.id ? { ...each, mark: was } : each.id === taken ? { ...each, mark } : each)),
  });
  return { label: titled(block, mark ? `${MARKS[mark].label} 표시` : '표시 빼기'), block: block.id, undo, redo: (draft) => ({ blocks: withMark(draft.blocks, block.id, mark).blocks }) };
}

export function addToggle(toggle: Toggle, at: number): Step {
  const { put, take } = presence(toggle, at, sameToggle);
  return { label: `‘${toggle.label}’ 토글 만들기`, block: null, undo: (draft) => ({ toggles: take(draft.toggles) }), redo: (draft) => ({ toggles: put(draft.toggles) }) };
}

export function removeToggle(toggle: Toggle, at: number): Step {
  const { put, take } = presence(toggle, at, sameToggle);
  return { label: `‘${toggle.label}’ 토글 지우기`, block: null, undo: (draft) => ({ toggles: put(draft.toggles) }), redo: (draft) => ({ toggles: take(draft.toggles) }) };
}

// The whole toggle swaps, since nothing is typed into one in place.
export function editToggle(before: Toggle, after: Toggle, what: 'label' | 'default'): Step {
  const to = (toggle: Toggle) => (draft: Draft): PromptPatch => ({ toggles: draft.toggles.map((each) => (each.key === before.key ? toggle : each)) });
  return { label: what === 'label' ? `‘${before.label}’ 토글 이름 바꾸기` : `‘${before.label}’ 처음 값 바꾸기`, block: null, undo: to(before), redo: to(after) };
}

export function renameKey(toggle: Toggle, to: string): Step {
  return { label: `‘${toggle.label}’ 조건에서 부르는 이름 바꾸기`, block: null, undo: (draft) => rekey(draft, to, toggle.key), redo: (draft) => rekey(draft, toggle.key, to) };
}
