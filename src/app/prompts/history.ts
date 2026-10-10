import type { Block, ChatRange, ChatSlot, RecentSlot, Role, TextBlock, Toggle, WrappedSlot } from '../../model/prompt';
import type { PromptPatch } from '../../runtime/prompts';
import { blockTitle, MARKS, SLOT } from './blocks';
import { keyInUse, moved, placedOnce, rekey, withMark, type Draft } from './edits';

// A toast's 되돌리기 undoes a step out of turn, so what a step puts back may no longer fit: the slot it held is taken, or
// its key is another toggle's.
export type Refused = { refused: string };

// Both apply to the draft as it is then and change only what the edit changed, so text typed in between survives either
// way. Typing is not a step: a text field keeps the browser's own undo.
export type Step = {
  label: string;
  block: string | null;
  undo: (draft: Draft) => PromptPatch | Refused;
  redo: (draft: Draft) => PromptPatch | Refused;
};

export type History = { done: readonly Step[]; undone: readonly Step[] };
export const NO_HISTORY: History = { done: [], undone: [] };

// A step refused changes nothing and leaves the history for good, so the steps under it can still be reached.
export type Turned = { step: Step; history: History } & ({ patch: PromptPatch } | Refused);

const turned = (step: Step, change: PromptPatch | Refused, applied: History, refused: History): Turned =>
  'refused' in change ? { step, history: refused, ...change } : { step, history: applied, patch: change };

export const doing = (history: History, draft: Draft, step: Step): Turned => turned(step, step.redo(draft), { done: [...history.done, step], undone: [] }, history);

// The last step done, or the one a toast's 되돌리기 names; null when it is not there to undo.
export function undoing(history: History, draft: Draft, step = history.done.at(-1)): Turned | null {
  if (!step || !history.done.includes(step)) return null;
  const done = history.done.filter((each) => each !== step);
  return turned(step, step.undo(draft), { done, undone: [...history.undone, step] }, { done, undone: history.undone });
}

export function redoing(history: History, draft: Draft): Turned | null {
  const step = history.undone.at(-1);
  if (!step) return null;
  const undone = history.undone.slice(0, -1);
  return turned(step, step.redo(draft), { done: [...history.done, step], undone }, { done: history.done, undone });
}

// Adding is put then take to undo, removing the other way round. joining: the item as it may stand among the others
// now, under the rules adding one keeps, or why it may not.
function presence<T extends object>(item: T, at: number, same: (a: T, b: T) => boolean, joining: (items: readonly T[], item: T) => T | Refused) {
  let kept = item;
  return {
    put: (items: readonly T[]): T[] | Refused => {
      const fit = joining(items, kept);
      return 'refused' in fit ? fit : [...items.slice(0, at), fit, ...items.slice(at)];
    },
    take: (items: readonly T[]) => {
      kept = items.find((each) => same(each, kept)) ?? kept;
      return items.filter((each) => !same(each, kept));
    },
  };
}

const sameBlock = (a: Block, b: Block) => a.id === b.id;
const sameToggle = (a: Toggle, b: Toggle) => a.key === b.key;
// A text comes back without a mark another text has taken since: its words matter more than the mark.
const joiningBlock = (blocks: readonly Block[], block: Block): Block | Refused => {
  if (block.kind === 'slot') return placedOnce(blocks, block.slot) ? { refused: `'${SLOT[block.slot].name}' 블록은 하나만 둘 수 있어요.` } : block;
  return block.mark && blocks.some((each) => each.kind === 'text' && each.mark === block.mark) ? { ...block, mark: null } : block;
};
const keyTaken = (key: string): Refused => ({ refused: `'${key}' 키를 다른 토글이 쓰고 있어요.` });
const joiningToggle = (toggles: readonly Toggle[], toggle: Toggle): Toggle | Refused => (keyInUse(toggles, toggle.key) ? keyTaken(toggle.key) : toggle);
const blocksOr = (blocks: Block[] | Refused): PromptPatch | Refused => ('refused' in blocks ? blocks : { blocks });
const togglesOr = (toggles: Toggle[] | Refused): PromptPatch | Refused => ('refused' in toggles ? toggles : { toggles });
const titled = (block: Block, what: string) => `'${blockTitle(block).title}' ${what}`;
const onBlock = (id: string, change: (block: Block) => Block) => (draft: Draft): PromptPatch => ({
  blocks: draft.blocks.map((each) => (each.id === id ? change(each) : each)),
});

export function addBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock, joiningBlock);
  return { label: titled(block, '블록 추가'), block: block.id, undo: (draft) => ({ blocks: take(draft.blocks) }), redo: (draft) => blocksOr(put(draft.blocks)) };
}

export function removeBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock, joiningBlock);
  return { label: titled(block, '블록 빼기'), block: block.id, undo: (draft) => blocksOr(put(draft.blocks)), redo: (draft) => ({ blocks: take(draft.blocks) }) };
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

export function setCount(block: RecentSlot, count: number): Step {
  const to = (value: number) => onBlock(block.id, (each) => (each.kind === 'slot' && each.slot === 'recent' ? { ...each, count: value } : each));
  return { label: titled(block, '메시지 수 바꾸기'), block: block.id, undo: to(block.count), redo: to(count) };
}

export function setTranslations(block: RecentSlot, on: boolean): Step {
  const to = (value: boolean) =>
    onBlock(block.id, (each) => {
      if (each.kind !== 'slot' || each.slot !== 'recent') return each;
      const next: RecentSlot = { ...each };
      if (value) delete next.translations;
      else next.translations = false;
      return next;
    });
  return { label: titled(block, on ? '번역 포함' : '번역 빼기'), block: block.id, undo: to(!on), redo: to(on) };
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

// Trades the 감싸는 텍스트 there for the one the step holds, so one function is both ways: each apply puts back what the one
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
  return { label: titled(block, wrapper === null ? '감싸는 텍스트 빼기' : '감싸는 텍스트 추가'), block: block.id, undo: trade, redo: trade };
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
  const { put, take } = presence(toggle, at, sameToggle, joiningToggle);
  return { label: `'${toggle.label}' 토글 만들기`, block: null, undo: (draft) => ({ toggles: take(draft.toggles) }), redo: (draft) => togglesOr(put(draft.toggles)) };
}

export function removeToggle(toggle: Toggle, at: number): Step {
  const { put, take } = presence(toggle, at, sameToggle, joiningToggle);
  return { label: `'${toggle.label}' 토글 삭제`, block: null, undo: (draft) => togglesOr(put(draft.toggles)), redo: (draft) => ({ toggles: take(draft.toggles) }) };
}

// The whole toggle swaps, since nothing is typed into one in place.
export function editToggle(before: Toggle, after: Toggle, what: 'label' | 'default'): Step {
  const to = (toggle: Toggle) => (draft: Draft): PromptPatch => ({ toggles: draft.toggles.map((each) => (each.key === before.key ? toggle : each)) });
  return { label: what === 'label' ? `'${before.label}' 토글 이름 바꾸기` : `'${before.label}' 기본값 바꾸기`, block: null, undo: to(before), redo: to(after) };
}

export function renameKey(toggle: Toggle, to: string): Step {
  const renamed = (from: string, next: string) => (draft: Draft) => (keyInUse(draft.toggles, next) ? keyTaken(next) : rekey(draft, from, next));
  return { label: `'${toggle.label}' 키 바꾸기`, block: null, undo: renamed(to, toggle.key), redo: renamed(toggle.key, to) };
}
