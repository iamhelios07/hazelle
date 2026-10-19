import { entryName } from '../../connectors/types';
import { FEATURES, type Feature } from '../../model/features';
import { MASCOT, MASCOTS } from '../../model/mascot';
import { illustrateSwitches, translateSwitches } from '../../runtime/characters';
import { setFeatureAt, sharedFeatures } from '../../runtime/features';
import { drawingModels } from '../../runtime/illustrate';
import { defaultMemory } from '../../runtime/memory-read';
import type { ObjectStore } from '../../runtime/store';
import { imageModelOf } from '../common/IllustrateRows';
import { languageLabel } from '../common/languages';
import { chosenPrompt } from '../common/TaskPrompt';
import { count } from '../common/typedNumber';
import { FEATURE_NAMES, FEATURES_TITLE, NOT_STARRED } from '../common/words';
import { useConnections, usePrompts, useSettings, useStore } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { List, ListItem, Section, Switch } from '../ui';

export const FEATURE_HELP = '끄면 채팅에서 보이지 않고 작동하지 않아요. 프롬프트, 캐릭터, 채팅에서 따로 켤 수 있어요.';

const state = (on: boolean) => (on ? '켜짐' : '꺼짐');

// One line of what a new chat with no character of its own gets, read through the same setups the chat reads.
const LINES: Record<Feature, (store: ObjectStore, routes: ReturnType<typeof drawingModels>) => string> = {
  translate: (store) => {
    const translate = translateSwitches(store, null);
    return [`응답 번역 ${state(translate.replies)}`, languageLabel(translate.replyLanguage), chosenPrompt(store, 'translate', translate.prompt).label].join(' · ');
  },
  illustrate: (store, routes) => {
    const illustrate = illustrateSwitches(store, null);
    const image = imageModelOf(routes, illustrate)?.model;
    const model = !routes.length ? '이미지 모델 없음' : image ? entryName(image) : NOT_STARRED;
    return `자동 삽화 ${state(illustrate.auto)} · ${model}`;
  },
  memory: (store) => {
    const memory = defaultMemory(store);
    return `새 채팅에서 ${state(memory.on)} · 기록 ${count(memory.budget)} 토큰`;
  },
  mascot: (store) => `${MASCOTS[MASCOT].name} · ${chosenPrompt(store, 'mascot', undefined).label}`,
};

// 공용's availability, the bottom rung of the 기능 ladder: a switch with no layer above it to follow.
export function FeatureSwitch({ feature }: { feature: Feature }) {
  const store = useStore();
  const toast = useToast();
  // Subscribed for sharedFeatures, which reads the settings from the store.
  useSettings();
  return (
    <Switch
      label={FEATURE_NAMES[feature]}
      checked={sharedFeatures(store)[feature]}
      onChange={(on) => void setFeatureAt(store, { kind: 'settings' }, feature, on).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'))}
    />
  );
}

export function FeatureDefaults() {
  const store = useStore();
  // Subscribed for LINES, which read the settings, the prompts and the image models from the store.
  useSettings();
  usePrompts();
  const routes = drawingModels(useConnections());
  return (
    <Section title={FEATURES_TITLE} help={FEATURE_HELP}>
      <List label={FEATURES_TITLE} box places>
        {FEATURES.map((feature) => (
          <ListItem
            key={feature}
            title={FEATURE_NAMES[feature]}
            description={LINES[feature](store, routes)}
            control={<FeatureSwitch feature={feature} />}
            onClick={() => navigate({ kind: 'feature', feature })}
          />
        ))}
      </List>
    </Section>
  );
}
