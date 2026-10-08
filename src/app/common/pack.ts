import { readToggles } from '../../engine/import/toggles';
import type { Pack } from '../../engine/import/types';
import { SCRIPTS } from './words';

const counted = (counts: [string, number][]) => counts.flatMap(([label, count]) => (count > 0 ? [`${label} ${count}개`] : []));
const scriptCounts = ({ regex, triggers }: Pick<Pack, 'regex' | 'triggers'>) => counted([[SCRIPTS.regex, regex.length], [SCRIPTS.triggers, triggers.length]]);

export const scriptHolds = (pack: Pick<Pack, 'regex' | 'triggers'>): string => scriptCounts(pack).join(' · ');

// A pack's lorebook and assets are stored apart from it, so their counts are given.
export function packHolds(pack: Pack, lore: number, assets: number): string {
  const held = [...counted([['로어북', lore]]), ...scriptCounts(pack), ...counted([['토글', readToggles(pack.toggles).toggles.length], ['에셋', assets]]), ...(pack.background ? ['스타일'] : [])];
  return held.length > 0 ? held.join(' · ') : '담긴 것이 없어요';
}
