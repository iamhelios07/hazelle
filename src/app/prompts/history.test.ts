import { describe, expect, it } from 'vitest';
import type { TextBlock } from '../../model/prompt';
import type { PromptPatch } from '../../runtime/prompts';
import type { Draft } from './edits';
import { addBlock, NO_HISTORY, recorded, removeBlock, undoing } from './history';

const text = (id: string, words: string): TextBlock => ({ id, name: null, kind: 'text', role: 'system', text: words, mark: null });
const apply = (draft: Draft, change: (draft: Draft) => PromptPatch): Draft => ({ ...draft, ...change(draft) });
const typed = (draft: Draft, id: string, words: string): Draft => ({ ...draft, blocks: draft.blocks.map((block) => (block.id === id && block.kind === 'text' ? { ...block, text: words } : block)) });

describe('the prompt editor history', () => {
  it('undoes a step on the draft as it is then, keeping what was typed since, and redoes it with its own typing', () => {
    const start: Draft = { name: '', blocks: [text('a', '가')], toggles: [], authorNote: '' };
    const step = addBlock(text('b', ''), 1);
    let draft = apply(start, step.redo);
    draft = typed(typed(draft, 'a', '가나다'), 'b', '새 글');

    draft = apply(draft, step.undo);
    expect(draft.blocks).toEqual([text('a', '가나다')]);
    draft = apply(draft, step.redo);
    expect(draft.blocks).toEqual([text('a', '가나다'), text('b', '새 글')]);
  });

  it('undoes the step a toast names and leaves the others on the stack', () => {
    const first = removeBlock(text('a', ''), 0);
    const second = removeBlock(text('b', ''), 0);
    const history = recorded(recorded(NO_HISTORY, first), second);

    const undone = undoing(history, first);
    expect(undone?.history).toEqual({ done: [second], undone: [first] });
    expect(undoing(undone!.history, first)).toBeNull();
  });
});
