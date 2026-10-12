import { describe, expect, it } from 'vitest';
import type { Block } from '../../model/prompt';
import { cacheShown, editorOf, flippedCache, NO_PANELS, opened } from './panels';

describe('the panels beside the story', () => {
  const editor = { kind: 'character', id: 'c', part: null } as const;

  it('keeps the cache panel beside an editor where two fit, and one panel at a time elsewhere', () => {
    const cache = flippedCache(NO_PANELS, true);
    const both = opened(cache, editor, true);
    expect([both, cacheShown(both, true)]).toEqual([{ panel: editor, cache: true }, true]);
    expect(opened(both, { kind: 'toggles' }, true)).toEqual({ panel: { kind: 'toggles' }, cache: false });
    expect(flippedCache(both, true)).toEqual({ panel: editor, cache: false });
    expect(opened(cache, editor, false)).toEqual({ panel: editor, cache: false });
    expect(flippedCache({ panel: editor, cache: false }, false)).toEqual({ panel: null, cache: true });
    expect(cacheShown(both, false)).toBe(false);
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
