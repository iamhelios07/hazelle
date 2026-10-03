import type { Imported, ImportedModule } from '../../engine/import/types';
import { unused } from '../../engine/pipeline';
import type { ImportedCharacter } from '../../runtime/characters';
import { packHolds } from '../common/pack';
import { describeUnused } from '../common/unused';
import { cardMissed, moduleMissed } from './missed';

// Completed reports must not retain asset readers: their closures keep the source archive alive.
export type ImportOutcome = { kind: 'character' | 'module'; file: string; id: string; title: string; holds: string; missed: string[]; unused: string | null };

export function characterOutcome(file: string, imported: Imported, { id, skipped, faceless }: ImportedCharacter): ImportOutcome {
  const { card, lore, assets, report } = imported;
  const holds = [
    `첫인사 ${card.greetings.length}개`,
    lore.length > 0 && `로어북 ${lore.length}개`,
    card.regex.length > 0 && `정규식 ${card.regex.length}개`,
    card.variables.length > 0 && `기본 변수 ${card.variables.length}개`,
    card.toggles.trim() && '토글',
    assets.length - skipped > 0 && `에셋 ${assets.length - skipped}개`,
  ].filter(Boolean).join(' · ');
  return { kind: 'character', file, id, title: card.name, holds, missed: cardMissed(report, skipped, faceless), unused: describeUnused(unused(card)) };
}

export function moduleOutcome(file: string, module: ImportedModule, id: string, skipped: number): ImportOutcome {
  return {
    kind: 'module', file, id, title: `모듈 · ${module.name}`,
    holds: packHolds(module.pack, module.lore.length, module.assets.length - skipped),
    missed: moduleMissed(module.unsupported, skipped), unused: null,
  };
}
