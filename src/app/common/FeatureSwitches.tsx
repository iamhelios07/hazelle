import { FEATURES, type Feature, type FeatureSwitches as Switches } from '../../model/features';
import { inherited, setFeatureAt, type FeatureOwner } from '../../runtime/features';
import { useLibrary, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { ChoiceGroup, Section, SettingGroup, SettingRow } from '../ui';
import { FEATURE_NAMES, FEATURES_TITLE, SCOPE, scopeTag } from './words';

type Owner = Exclude<FeatureOwner, { kind: 'settings' }>;
type Choice = 'default' | 'on' | 'off';

const WORKS: Record<Owner['kind'], string> = {
  prompt: '이 프롬프트를 쓰는 채팅에 적용돼요. 캐릭터나 채팅에서 따로 정한 값이 있으면 그 값을 따라요.',
  character: '이 캐릭터의 모든 채팅에 적용돼요. 채팅에서 따로 정한 값이 있으면 그 값을 따라요.',
  chat: '지금 이 채팅에만 적용돼요.',
};

// A layer's line in a list of parts: 기본값 while it sets nothing, else what it sets, 번역 끔 · 삽화 켬.
export const featureHolds = (own: Switches | undefined) =>
  own ? FEATURES.flatMap((feature) => (own[feature] === undefined ? [] : [`${FEATURE_NAMES[feature]} ${own[feature] ? '켬' : '끔'}`])).join(' · ') : SCOPE.default;

const choiceOf = (value: boolean | undefined): Choice => (value === undefined ? 'default' : value ? 'on' : 'off');

// own: the owner's features as stored. 공용's own switches are settings/FeatureDefaults' FeatureSwitch, with no 기본값.
export function FeatureSwitches({ owner, own }: { owner: Owner; own: Switches | undefined }) {
  const store = useStore();
  const toast = useToast();
  // Subscribed for inherited, which reads the farther layers from the store.
  useSettings();
  usePrompts();
  useLibrary();
  const from = inherited(store, owner);

  async function change(feature: Feature, choice: Choice) {
    const saved = await setFeatureAt(store, owner, feature, choice === 'default' ? null : choice === 'on');
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  return (
    <Section level={owner.kind === 'chat' ? 3 : undefined} title={FEATURES_TITLE} help={WORKS[owner.kind]} tag={owner.kind === 'prompt' ? undefined : scopeTag(own ? owner.kind : 'default')}>
      <SettingGroup label={FEATURES_TITLE}>
        {FEATURES.map((feature) => (
          <SettingRow
            key={feature}
            label={FEATURE_NAMES[feature]}
            control={
              <ChoiceGroup
                layout="fit"
                label={FEATURE_NAMES[feature]}
                options={[
                  { value: 'default', label: `${SCOPE.default} (${from[feature] ? '켜짐' : '꺼짐'})` },
                  { value: 'on', label: '켜기' },
                  { value: 'off', label: '끄기' },
                ]}
                value={choiceOf(own?.[feature])}
                onChange={(choice) => void change(feature, choice)}
              />
            }
          />
        ))}
      </SettingGroup>
    </Section>
  );
}
