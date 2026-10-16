import type { Feature } from '../../model/features';
import { illustrateSwitches, setIllustrate, setTranslate, translateSwitches } from '../../runtime/characters';
import { sceneWriterOf } from '../../runtime/illustrate';
import { sendsNotes, translatorOf } from '../../runtime/translate';
import { TRANSLATOR_CHAT } from '../../runtime/turn';
import { IllustrateRows } from '../common/IllustrateRows';
import type { PromptDoor } from '../common/TaskPrompt';
import { TranslateRows } from '../common/TranslateRows';
import { FEATURE_NAMES, NOTE_UNSENT, noteLines, PAGES, SCOPE } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { NavBar, Screen, Section, SettingGroup, SettingRow } from '../ui';
import { FEATURE_HELP, FeatureSwitch } from './FeatureDefaults';
import { GlobalNoteField } from './GlobalNoteField';
import { MemoryDefaults } from './MemoryDefaults';

const editPrompt = (door: PromptDoor) => navigate(door ? { kind: 'prompt', ...door } : { kind: 'prompts' });

// A feature's shared values, the layer every prompt, character and chat that sets none of its own reads.
export function FeatureScreen({ feature, back }: { feature: Feature; back: Back }) {
  const name = FEATURE_NAMES[feature];
  return (
    <Screen width="form" top={<NavBar title={name} subtitle={PAGES.chat} {...backBar(back)} />}>
      <SettingGroup label={name}>
        <SettingRow label={name} help={FEATURE_HELP} control={<FeatureSwitch feature={feature} />} />
      </SettingGroup>
      <Section title={SCOPE.default}>{feature === 'translate' ? <TranslateDefaults /> : feature === 'illustrate' ? <IllustrateDefaults /> : <MemoryDefaults />}</Section>
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
    <SettingGroup label={FEATURE_NAMES.illustrate}>
      <IllustrateRows
        illustrate={illustrateSwitches(store, null)}
        sceneWriter={sceneWriterOf(store, TRANSLATOR_CHAT)}
        card={null}
        opens="down"
        onChange={(change) => void setIllustrate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
        onEditPrompt={editPrompt}
      />
    </SettingGroup>
  );
}
