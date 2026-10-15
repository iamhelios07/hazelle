import { describe, expect, it } from 'vitest';
import type { Block } from '../../model/prompt';
import { inspectShown, editorOf, NO_PANELS, opened } from './panels';

describe('the panels beside the story', () => {
  const editor = { kind: 'character', id: 'c', part: null } as const;

  it('keeps every inspect tab beside an editor where two fit, and one panel at a time elsewhere', () => {
    for (const tab of ['request', 'cache', 'variables', 'modules', 'scripts'] as const) {
      const inspect = { kind: 'inspect', tab } as const;
      const openedInspect = opened(NO_PANELS, inspect, true);
      const both = opened(openedInspect, editor, true);
      expect([both, inspectShown(both, true)]).toEqual([{ panel: editor, inspect }, inspect]);
      expect(opened(both, { kind: 'toggles' }, true)).toEqual({ panel: { kind: 'toggles' }, inspect: null });
      expect(opened(openedInspect, editor, false)).toEqual({ panel: editor, inspect: null });
      expect(opened({ panel: editor, inspect: null }, inspect, false)).toEqual({ panel: null, inspect });
      expect(opened({ panel: editor, inspect: null }, inspect, true)).toEqual(both);
      expect(inspectShown(both, false)).toBeNull();
    }
  });
});

describe('the editor a cache row opens', () => {
  const blocks: Block[] = [{ id: 'main', name: null, kind: 'text', role: 'system', mark: null, text: '' }];
  const prompt = { id: 'p', blocks };
  const owner = (id: string) => (id === 'mine' ? 'c' : 'module');

  it('opens a block of the chat prompt, the character’s 설명 and its own lorebook entries, and nothing else', () => {
    expect(editorOf({ kind: 'block', id: 'main', name: null, slot: null }, prompt, 'c', owner)).toEqual({ kind: 'prompts', id: 'p', pane: null, block: 'main' });
    expect(editorOf({ kind: 'block', id: 'utility:description', name: null, slot: 'description' }, prompt, 'c', owner)).toEqual({ kind: 'character', id: 'c', part: 'character' });
    expect(editorOf({ kind: 'depth', id: 'mine', name: 'mood', depth: 1 }, prompt, 'c', owner)).toEqual({ kind: 'character', id: 'c', part: 'lore' });
    expect(editorOf({ kind: 'lore', id: 'theirs', name: 'x', slot: 'lorebook' }, prompt, 'c', owner)).toBeNull();
    expect(editorOf({ kind: 'block', id: 'utility:main', name: null, slot: null }, prompt, 'c', owner)).toBeNull();
    expect(editorOf({ kind: 'block', name: null, slot: 'description' }, prompt, null, owner)).toBeNull();
  });
});
