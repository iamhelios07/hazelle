import { describe, expect, it } from 'vitest';
import type { Block, TextBlock } from '../../model/prompt';
import type { Draft } from './edits';
import { addBlock, doing, NO_HISTORY, removeBlock, undoing, type History, type Turned } from './history';

const text = (id: string, words: string): TextBlock => ({ id, name: null, kind: 'text', role: 'system', text: words, mark: null });
const persona = (id: string): Block => ({ id, name: null, kind: 'slot', slot: 'persona', role: 'system', wrapper: null });
const draftOf = (blocks: Block[]): Draft => ({ name: '', blocks, toggles: [], authorNote: '' });
const after = (draft: Draft, turned: Turned | null): Draft => (turned && 'patch' in turned ? { ...draft, ...turned.patch } : draft);
const typed = (draft: Draft, id: string, words: string): Draft => ({ ...draft, blocks: draft.blocks.map((block) => (block.id === id && block.kind === 'text' ? { ...block, text: words } : block)) });

describe('the prompt editor history', () => {
  it('undoes a step on the draft as it is then, keeping what was typed since, and redoes it with its own typing', () => {
    const step = addBlock(text('b', ''), 1);
    let draft = after(draftOf([text('a', '가')]), doing(NO_HISTORY, draftOf([text('a', '가')]), step));
    draft = typed(typed(draft, 'a', '가나다'), 'b', '새 글');

    draft = { ...draft, ...step.undo(draft) };
    expect(draft.blocks).toEqual([text('a', '가나다')]);
    draft = { ...draft, ...step.redo(draft) };
    expect(draft.blocks).toEqual([text('a', '가나다'), text('b', '새 글')]);
  });

  it('undoes the step a toast names and leaves the others on the stack', () => {
    const first = removeBlock(text('a', ''), 0);
    const second = removeBlock(text('b', ''), 0);
    const history: History = { done: [first, second], undone: [] };

    const undone = undoing(history, draftOf([]), first);
    expect(undone?.history).toEqual({ done: [second], undone: [first] });
    expect(undoing(undone!.history, draftOf([]), first)).toBeNull();
  });

  it('refuses to put back a slot placed once while another stands, changing nothing and dropping the step', () => {
    const removal = removeBlock(persona('old'), 0);
    const addition = addBlock(persona('new'), 0);
    const draft = draftOf([persona('new')]);
    const history: History = { done: [removal, addition], undone: [] };

    const refused = undoing(history, draft, removal);
    expect(refused).toMatchObject({ refused: expect.stringContaining('하나만 둘 수 있어요'), history: { done: [addition], undone: [] } });
    expect(after(draft, refused)).toBe(draft);
  });
});
