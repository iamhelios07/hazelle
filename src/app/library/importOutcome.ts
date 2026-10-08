import type { Imported, ImportedModule } from '../../engine/import/types';
import { unused } from '../../engine/pipeline';
import type { ImportedCharacter } from '../../runtime/characters';
import type { ModulePlace } from '../../runtime/modules';
import { packHolds } from '../common/pack';
import { describeUnused } from '../common/unused';
import { ALWAYS, inSettings, NO_CHARACTER } from '../common/words';
import { cardMissed, moduleMissed } from './missed';

// Completed reports must not retain asset readers: their closures keep the source archive alive. A chat's id is null
// when the file held several.
export type ImportOutcome = { file: string; title: string; holds: string; placed: { text: string; failed: boolean } | null; missed: string[]; unused: string | null } & ({ kind: 'character' | 'module'; id: string } | { kind: 'chat'; id: string | null });
// at: where it was dropped (design §6.5), null where nothing takes it. failure: why turning it on there failed.
export type Placement = { at: ModulePlace['kind'] | null; failure: string | null };

const PLACES: Record<ModulePlace['kind'], string> = { character: '이 캐릭터에', prompt: '이 프롬프트에', always: ALWAYS };

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
  return { kind: 'character', file, id, title: card.name, holds, placed: null, missed: cardMissed(report, skipped, faceless), unused: describeUnused(unused(card)) };
}

export function moduleOutcome(file: string, module: ImportedModule, id: string, skipped: number, { at, failure }: Placement): ImportOutcome {
  return {
    kind: 'module', file, id, title: `모듈 · ${module.name}`,
    holds: packHolds(module.pack, module.lore.length, module.assets.length - skipped),
    placed: at === null
      ? { text: `어디에도 켜지 않았어요. ${inSettings('modules')}에서 켤 수 있어요.`, failed: false }
      : failure === null ? { text: `${PLACES[at]} 켰어요.`, failed: false } : { text: `${PLACES[at]} 켜지 못했어요. ${failure}`, failed: true },
    missed: moduleMissed(module.unsupported, skipped), unused: null,
  };
}

// character: the name of the one they went to, null for 캐릭터 없이.
export function chatOutcome(file: string, ids: string[], character: string | null, missed: string[]): ImportOutcome {
  return { kind: 'chat', file, id: ids.length === 1 ? ids[0]! : null, title: file, holds: `채팅 ${ids.length}개`, placed: { text: character === null ? `${NO_CHARACTER} 넣었어요.` : `${character}에 넣었어요.`, failed: false }, missed, unused: null };
}
