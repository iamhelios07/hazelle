import { readToggles } from '../../engine/import/toggles';
import type { Pack } from '../../engine/import/types';
import { SCRIPTS } from './words';

// A pack's lorebook and assets are stored apart from it, so their counts are given.
export function packHolds(pack: Pack, lore: number, assets: number): string {
  const counted: [string, number][] = [
    ['로어북', lore],
    [SCRIPTS.regex, pack.regex.length],
    [SCRIPTS.triggers, pack.triggers.length],
    ['토글', readToggles(pack.toggles).toggles.length],
    ['에셋', assets],
  ];
  const held = [...counted.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}개`), ...(pack.background ? ['스타일'] : [])];
  return held.length > 0 ? held.join(' · ') : '담긴 것이 없어요';
}
