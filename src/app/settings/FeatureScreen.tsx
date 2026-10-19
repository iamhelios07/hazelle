import type { ComponentType } from 'react';
import type { Feature } from '../../model/features';
import { illustrateSwitches, setIllustrate, setTranslate, translateSwitches } from '../../runtime/characters';
import { sceneWriterOf } from '../../runtime/illustrate';
import { setDefaultPrompt } from '../../runtime/prompts';
import { sendsNotes, translatorOf } from '../../runtime/translate';
import { TRANSLATOR_CHAT } from '../../runtime/turn';
import { IllustrateRows } from '../common/IllustrateRows';
import { TaskPromptMenu, type PromptDoor } from '../common/TaskPrompt';
import { TranslateRows } from '../common/TranslateRows';
import { FEATURE_NAMES, MODEL_ROLES, NOTE_UNSENT, noteLines, PAGES } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { NavBar, Screen, SettingGroup, SettingRow } from '../ui';
import { FEATURE_HELP, FeatureSwitch } from './FeatureDefaults';
import { GlobalNoteField } from './GlobalNoteField';
import { MemoryDefaults } from './MemoryDefaults';

const editPrompt = (door: PromptDoor) => navigate(door ? { kind: 'prompt', ...door } : { kind: 'prompts', place: null });

export function FeatureScreen({ feature, back }: { feature: Feature; back: Back }) {
  const name = FEATURE_NAMES[feature];
  const Defaults = DEFAULTS[feature];
  return (
    <Screen width="form" top={<NavBar title={name} subtitle={PAGES.chat} {...backBar(back)} />}>
      <SettingGroup label={name}>
        <SettingRow label={name} help={FEATURE_HELP} control={<FeatureSwitch feature={feature} />} />
      </SettingGroup>
      <Defaults />
    </Screen>
  );
}

function TranslateDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // translatorOf reads these too.
  usePrompts();
  useConnections();
  const translation = translatorOf(store, TRANSLATOR_CHAT);
  const unsent = noteLines(settings.translatorNote) > 0 && translation.ok && !sendsNotes(translation.prompt);
  return (
    <>
      <SettingGroup label={FEATURE_NAMES.translate}>
        <TranslateRows
          translate={translateSwitches(store, null)}
          translation={translation}
          card={null}
          opens="down"
          onChange={(change) => void setTranslate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
          onEditPrompt={editPrompt}
        />
      </SettingGroup>
      <GlobalNoteField error={unsent ? NOTE_UNSENT : undefined} />
    </>
  );
}

function IllustrateDefaults() {
  const store = useStore();
  const toast = useToast();
  // illustrateSwitches and sceneWriterOf read these.
  useSettings();
  usePrompts();
  useConnections();
  useProfiles();
  return (
    <IllustrateRows
      illustrate={illustrateSwitches(store, null)}
      sceneWriter={sceneWriterOf(store, TRANSLATOR_CHAT)}
      card={null}
      opens="down"
      onChange={(change) => void setIllustrate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
      onEditPrompt={editPrompt}
    />
  );
}

// The mascot's prompt is the account's default alone (design §6.11): picking one here makes it the default.
function MascotDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // chosenPrompt reads these.
  usePrompts();
  return (
    <SettingGroup label={FEATURE_NAMES.mascot}>
      <SettingRow
        label="마스코트 프롬프트"
        help={`응답마다 ${MODEL_ROLES.aux}을 한 번 더 불러요. 마스코트 프롬프트에서 다른 모델을 고를 수 있어요.`}
        control={
          <TaskPromptMenu
            task="mascot"
            chosen={settings.mascotPrompt}
            heading="모든 채팅에 적용돼요."
            opens="down"
            onPick={(prompt) => void setDefaultPrompt(store, prompt!).then((saved) => saved.ok || toast.failed(saved))}
            onEdit={editPrompt}
          />
        }
      />
    </SettingGroup>
  );
}

const DEFAULTS: Record<Feature, ComponentType> = { translate: TranslateDefaults, illustrate: IllustrateDefaults, memory: MemoryDefaults, mascot: MascotDefaults };
