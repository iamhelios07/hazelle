import type { From } from '../../engine/pipeline';
import type { Block } from '../../model/prompt';
import type { CharacterPart } from '../common/characterPart';

// block: the prompt block the editor opens at, absent for its list.
export type Side = { kind: 'prompts'; id: string | null; pane: 'toggles' | null; block?: string } | { kind: 'character'; id: string; part: CharacterPart | null };
export type Panel = { kind: 'toggles' } | { kind: 'memory'; record: string | null } | { kind: 'info' } | { kind: 'tool'; module: string } | { kind: 'bookmarks' } | { kind: 'lore' } | Side;

const isSide = (panel: Panel): panel is Side => panel.kind === 'prompts' || panel.kind === 'character';

// What stands beside the story. The cache panel stays open beside an editor where two panels stand beside the page
// (pairs), so a break is fixed while its forecast follows; elsewhere one panel at a time, the newest.
export type Panels = { panel: Panel | null; cache: boolean };

export const NO_PANELS: Panels = { panel: null, cache: false };

export const cacheShown = ({ panel, cache }: Panels, pairs: boolean) => cache && (panel === null || pairs);

export const opened = ({ cache }: Panels, panel: Panel, pairs: boolean): Panels => ({ panel, cache: cache && pairs && isSide(panel) });

export function flippedCache(panels: Panels, pairs: boolean): Panels {
  if (cacheShown(panels, pairs)) return { ...panels, cache: false };
  const { panel } = panels;
  return { panel: pairs && panel && isSide(panel) ? panel : null, cache: true };
}

// The editor a part of the prompt is written in: a block of the chat's prompt, the character's 설명 or one of its
// lorebook entries. A part from a print stored before ids were kept, a module's or a persona's entry, or the app's
// own block (utility ids) has none.
export function editorOf(from: From, prompt: { id: string; blocks: Block[] } | null, character: string | null, loreOwner: (id: string) => string | null): Side | null {
  switch (from.kind) {
    case 'block':
      if (from.slot === 'description') return character === null ? null : { kind: 'character', id: character, part: 'character' };
      return prompt && from.slot === null && prompt.blocks.some((block) => block.id === from.id) ? { kind: 'prompts', id: prompt.id, pane: null, block: from.id } : null;
    case 'lore':
    case 'depth':
      return character !== null && from.id !== undefined && loreOwner(from.id) === character ? { kind: 'character', id: character, part: 'lore' } : null;
    default:
      return null;
  }
}
