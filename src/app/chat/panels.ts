import type { Card } from '../../engine/import/types';
import type { From } from '../../engine/pipeline';
import type { Block } from '../../model/prompt';
import type { CharacterPart } from '../common/characterPart';
import type { PromptPane, Route } from '../shell/routes';
import type { ToggleSection } from './toggles';

// block: the prompt block the editor opens at, absent for its list. fromToggles: opened from the chat's 토글 panel,
// which its 토글 pane goes back to.
export type Side = { kind: 'prompts'; id: string | null; pane: PromptPane | null; block?: string; fromToggles?: true } | { kind: 'character'; id: string; part: CharacterPart | null };
export type InspectTab = 'request' | 'cache' | 'variables' | 'modules' | 'scripts';
export type InspectPanel = { kind: 'inspect'; tab: InspectTab };
export type InfoTab = 'reply' | 'lore' | 'memory' | 'request' | 'response';
export type Panel = InspectPanel | { kind: 'toggles' } | { kind: 'memory'; record: string | null } | { kind: 'info'; tab: InfoTab } | { kind: 'tool'; module: string } | { kind: 'bookmarks' } | { kind: 'lore' } | Side;

const isSide = (panel: Panel): panel is Side => panel.kind === 'prompts' || panel.kind === 'character';

// The inspect panel stays open beside an editor where two panels stand beside the page (pairs), so a break is
// fixed while its preview follows; elsewhere one panel at a time, the newest.
export type Panels = { panel: Exclude<Panel, InspectPanel> | null; inspect: InspectPanel | null };

export const NO_PANELS: Panels = { panel: null, inspect: null };

export const inspectShown = ({ panel, inspect }: Panels, pairs: boolean) => panel === null || pairs ? inspect : null;

export function opened(current: Panels, panel: Panel, pairs: boolean): Panels {
  if (panel.kind === 'inspect') return { panel: pairs && current.panel && isSide(current.panel) ? current.panel : null, inspect: panel };
  return { panel, inspect: pairs && isSide(panel) ? current.inspect : null };
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

// Where a chat's 로어북 최대 분량 is set, as chat-context reads it: the character's own, in its editor's
// 로어북 part; null for the account's, in 설정 › 채팅.
export const loreBudgetEditor = (character: { id: string; card: Card } | null): Side | null => (character && character.card.loreSettings.tokenBudget !== null ? { kind: 'character', id: character.id, part: 'lore' } : null);

// Where a section of the chat's 토글 panel has its toggles edited: the prompt's and the character's beside the chat, a
// module's on its 토글 page, since a module has no editor beside the chat.
export function toggleEditor({ from, id }: Pick<ToggleSection, 'from' | 'id'>): Side | Extract<Route, { kind: 'module' }> {
  switch (from) {
    case 'prompt':
      return { kind: 'prompts', id, pane: 'toggles', fromToggles: true };
    case 'card':
      return { kind: 'character', id, part: 'toggles' };
    case 'module':
      return { kind: 'module', id, pane: 'toggles' };
  }
}
