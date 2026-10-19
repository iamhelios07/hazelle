import { useState, type ComponentType } from 'react';
import type { Feature } from '../../model/features';
import type { PrereadParts } from '../../model/settings';
import { illustrateSwitches, setIllustrate, setTranslate, translateSwitches } from '../../runtime/characters';
import { availableFeatures } from '../../runtime/features';
import { PREREAD_STARTS, prereadSetup, setPreread } from '../../runtime/preread';
import { sceneWriterOf } from '../../runtime/illustrate';
import { setDefaultPrompt } from '../../runtime/prompts';
import { sendsNotes, translatorOf } from '../../runtime/translate';
import { TRANSLATOR_CHAT } from '../../runtime/turn';
import { IllustrateRows } from '../common/IllustrateRows';
import { Missing } from '../common/Missing';
import { TaskPromptMenu, type PromptDoor } from '../common/TaskPrompt';
import { TranslateRows } from '../common/TranslateRows';
import { typedText } from '../common/typed';
import { readOptional } from '../common/typedNumber';
import { FEATURE_NAMES, MODEL_ROLES, NOTE_UNSENT, noteLines, PAGES, PRE_READ, PRE_READ_HELP, PRE_READ_PARTS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { NavBar, NumberInput, Screen, SettingGroup, SettingRow, Switch } from '../ui';
import { FEATURE_HELP, FeatureSwitch } from './FeatureDefaults';
import { GlobalNoteField } from './GlobalNoteField';
import { MemoryDefaults } from './MemoryDefaults';

const editPrompt = (door: PromptDoor) => navigate(door ? { kind: 'prompt', ...door } : { kind: 'prompts', place: null });

export function FeatureScreen({ feature, back }: { feature: Feature; back: Back }) {
  const available = availableFeatures(useSettings()).includes(feature);
  const name = FEATURE_NAMES[feature];
  const Defaults = DEFAULTS[feature];
  if (!available) return <Missing what="feature" back={back} />;
  return (
    <Screen width="form" top={<NavBar title={name} subtitle={PAGES.chat} {...backBar(back)} />}>
      <SettingGroup label={name}>
        <SettingRow label={name} help={feature === 'preread' ? `${PRE_READ_HELP} ${FEATURE_HELP}` : FEATURE_HELP} control={<FeatureSwitch feature={feature} />} />
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
      <TranslateRows
        translate={translateSwitches(store, null)}
        translation={translation}
        card={null}
        opens="down"
        onChange={(change) => void setTranslate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
        onEditPrompt={editPrompt}
      />
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

const PART_HELP: Partial<Record<keyof PrereadParts, string>> = { system: '형식 규칙이나 지시는 줄이면 잘 안 지켜질 수 있어요.' };
// null: not a count the field takes.
const readWhole = (text: string) => {
  const count = readOptional(text, true);
  return count !== undefined && count !== null && count >= 0 ? count : null;
};

function CountRow({ label, unit, help, value, start, onChange }: { label: string; unit: string; help: string; value: number; start: number; onChange: (value: number) => void }) {
  const [typed, setTyped] = useState<string>();
  const draft = typedText(typed, readWhole, value, String);
  const invalid = readWhole(draft) === null;
  const type = (next: string) => {
    setTyped(next);
    const count = readWhole(next);
    if (count !== null) onChange(count);
  };
  return (
    <SettingRow
      label={label}
      help={help}
      changed={value !== start}
      error={invalid ? '0 이상의 정수를 입력해 주세요.' : undefined}
      control={<NumberInput label={label} unit={unit} value={draft} invalid={invalid} onChange={type} />}
    />
  );
}

// The account's alone, as the mascot's prompt is: picking a prompt here makes it the default.
function PrereadDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // chosenPrompt reads these.
  usePrompts();
  const setup = prereadSetup(store);
  const save = (change: Parameters<typeof setPreread>[1]) => void setPreread(store, change).then((saved) => saved.ok || toast.failed(saved));
  return (
    <>
      <SettingGroup label="줄일 부분">
        {(Object.entries(PRE_READ_PARTS) as [keyof PrereadParts, string][]).map(([part, label]) => (
          <SettingRow
            key={part}
            label={label}
            help={PART_HELP[part]}
            changed={setup.parts[part] !== PREREAD_STARTS.parts[part]}
            control={<Switch label={label} checked={setup.parts[part]} onChange={(on) => save({ parts: { ...setup.parts, [part]: on } })} />}
          />
        ))}
      </SettingGroup>
      <SettingGroup label={PRE_READ}>
        <CountRow label="원문으로 둘 최근 대화" unit="개" help="마지막으로 보낸 내 메시지는 이 수와 상관없이 그대로 보내요." value={setup.recent} start={PREREAD_STARTS.recent} onChange={(recent) => save({ recent })} />
        <CountRow label="한 번에 줄일 분량" unit="토큰" help="줄일 내용이 이만큼 쌓이면 그때 줄여요. 그보다 적으면 그냥 보내요." value={setup.batch} start={PREREAD_STARTS.batch} onChange={(batch) => save({ batch })} />
        <SettingRow
          label={`${PRE_READ} 프롬프트`}
          help={`응답마다 ${MODEL_ROLES.aux}을 한 번 더 불러요. PDF를 읽는 Gemini 모델이면 PDF로 보내서 더 아껴요. ${PRE_READ} 프롬프트에서 다른 모델을 고를 수 있어요.`}
          control={
            <TaskPromptMenu
              task="preread"
              chosen={settings.prereadPrompt}
              heading="모든 채팅에 적용돼요."
              opens="down"
              onPick={(prompt) => void setDefaultPrompt(store, prompt!).then((saved) => saved.ok || toast.failed(saved))}
              onEdit={editPrompt}
            />
          }
        />
      </SettingGroup>
    </>
  );
}

const DEFAULTS: Record<Feature, ComponentType> = { translate: TranslateDefaults, illustrate: IllustrateDefaults, memory: MemoryDefaults, mascot: MascotDefaults, preread: PrereadDefaults };
