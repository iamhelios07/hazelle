import type { ToolManifest } from '../../tool-api/manifest';
import type { ToolImport } from '../../runtime/tools/store';
import type { PresetRead } from '../../engine/import/preset';
import { mergeUnsupported, unsupportedCount, type Imported, type ImportedModule, type Unsupported } from '../../engine/import/types';
import { isToggle } from '../../model/prompt';
import { unused } from '../../engine/pipeline';
import type { ImportedCharacter } from '../../runtime/characters';
import type { ModulePlace } from '../../runtime/modules';
import { packHolds } from '../common/pack';
import { describeUnused } from '../common/unused';
import { ALWAYS, inSettings, NO_CHARACTER, promptName, SCRIPTS, TOOL, toolVersion } from '../common/words';
import { cardMissed, missedLines, presetMissed } from './missed';

// Completed reports must not retain asset readers: their closures keep the source archive alive. A chat's id is null
// when the file held several. paired: the prompts a module, or the modules a prompt, was turned on with because a Risu
// preset named the module.
export type ImportOutcome = { file: string; title: string; holds: string; placed: Line | null; paired: Line | null; missed: string[]; unused: string | null } & ({ kind: 'character' | 'module' | 'prompt'; id: string } | { kind: 'chat'; id: string | null });
type Line = { text: string; failed: boolean };
// at: where it was dropped (design §6.5), null where nothing takes it. failure: why turning it on there failed.
export type Placement = { at: ModulePlace['kind'] | null; failure: string | null };
// prompts: the names of the prompts whose preset named the module, turned on there. failure: why that failed.
export type Pairing = { prompts: string[]; failure: string | null };

const PLACES: Record<ModulePlace['kind'], string> = { character: '이 캐릭터에', prompt: '이 프롬프트에', persona: '이 페르소나에', always: ALWAYS };

export function characterOutcome(file: string, imported: Imported, { id, unsupported, faceless }: ImportedCharacter): ImportOutcome {
  const { card, lore, assets, report } = imported;
  const holds = [
    `첫인사 ${card.greetings.length}개`,
    lore.length > 0 && `로어북 ${lore.length}개`,
    card.regex.length > 0 && `${SCRIPTS.regex} ${card.regex.length}개`,
    card.variables.length > 0 && `기본 변수 ${card.variables.length}개`,
    card.toggles.some(isToggle) && '토글',
    assets.length - unsupportedCount(unsupported) > 0 && `에셋 ${assets.length - unsupportedCount(unsupported)}개`,
  ].filter(Boolean).join(' · ');
  return { kind: 'character', file, id, title: card.name, holds, placed: null, paired: null, missed: cardMissed(mergeUnsupported(report.unsupported, unsupported), faceless), unused: describeUnused(unused(card)) };
}

const quoted = (names: string[]) => names.map((name) => `'${name}'`).join(', ');

export function moduleOutcome(file: string, module: ImportedModule, id: string, unsupported: Unsupported, placement: Placement, { prompts, failure }: Pairing): ImportOutcome {
  const paired = failure !== null ? { text: `프롬프트에 켜지 못했어요. ${failure}`, failed: true } : prompts.length > 0 ? { text: `${quoted(prompts)} 프롬프트에 켰어요.`, failed: false } : null;
  return {
    kind: 'module', file, id, title: `모듈 · ${module.name}`,
    holds: packHolds(module.pack, module.lore.length, module.assets.length - unsupportedCount(unsupported)),
    // On for a prompt, it is not "on nowhere".
    placed: placement.at === null && paired !== null && !paired.failed ? null : modulePlacement(placement),
    paired,
    missed: missedLines(mergeUnsupported(module.unsupported, unsupported)), unused: null,
  };
}

// character: the name of the one they went to, null for 캐릭터 없이.
export function chatOutcome(file: string, ids: string[], character: string | null, missed: string[]): ImportOutcome {
  return { kind: 'chat', file, id: ids.length === 1 ? ids[0]! : null, title: file, holds: `채팅 ${ids.length}개`, placed: { text: character === null ? `${NO_CHARACTER} 넣었어요.` : `${character}에 넣었어요.`, failed: false }, paired: null, missed, unused: null };
}

// modules: the names of the modules its preset named that were here, turned on for it.
export function promptOutcome(file: string, { prompt, unsupported }: PresetRead, id: string, modules: string[]): ImportOutcome {
  const toggles = prompt.toggles.filter(isToggle).length;
  return {
    kind: 'prompt', file, id, title: `프롬프트 · ${promptName(prompt.name)}`,
    holds: [`블록 ${prompt.blocks.length}개`, toggles > 0 && `토글 ${toggles}개`, prompt.authorNote.trim() && '기본 노트'].filter(Boolean).join(' · '),
    placed: null,
    paired: modules.length > 0 ? { text: `${quoted(modules)} 모듈을 이 프롬프트에 켰어요.`, failed: false } : null,
    missed: presetMissed(unsupported), unused: null,
  };
}

const modulePlacement = ({ at, failure }: Placement): ImportOutcome['placed'] => at === null
      ? { text: `어디에도 켜지 않았어요. ${inSettings('modules')}에서 켤 수 있어요.`, failed: false }
      : failure === null ? { text: `${PLACES[at]} 켰어요.`, failed: false } : { text: `${PLACES[at]} 켜지 못했어요. ${failure}`, failed: true };

export function toolOutcome(file: string, manifest: ToolManifest, saved: ToolImport, placement: Placement): ImportOutcome {
  return {
    kind: 'module', file, id: saved.id, title: `모듈 · ${manifest.displayName}`,
    holds: !saved.previous ? [TOOL, manifest.version].filter(Boolean).join(' · ')
      : saved.previous.manifest.version === manifest.version ? '같은 버전을 다시 가져왔어요'
      : `버전을 바꿨어요 · ${toolVersion(saved.previous.manifest.version)} → ${toolVersion(manifest.version)}`,
    placed: saved.previous ? null : modulePlacement(placement), paired: null, missed: [], unused: null,
  };
}
