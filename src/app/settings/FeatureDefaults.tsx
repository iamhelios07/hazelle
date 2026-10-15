import { FEATURES } from '../../model/features';
import { setFeatureAt } from '../../runtime/features';
import { FEATURE_NAMES, FEATURES_TITLE } from '../common/words';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Section, SettingGroup, SettingRow, Switch } from '../ui';

export function FeatureDefaults() {
  const store = useStore();
  const toast = useToast();
  const { features } = useSettings();
  return (
    <Section title={FEATURES_TITLE} help="끄면 채팅에서 보이지 않고 동작하지 않아요. 프롬프트, 캐릭터, 채팅에서 따로 켤 수 있어요.">
      <SettingGroup label={FEATURES_TITLE}>
        {FEATURES.map((feature) => (
          <SettingRow
            key={feature}
            label={FEATURE_NAMES[feature]}
            control={
              <Switch
                label={FEATURE_NAMES[feature]}
                checked={features?.[feature] ?? true}
                onChange={(on) => void setFeatureAt(store, { kind: 'settings' }, feature, on).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'))}
              />
            }
          />
        ))}
      </SettingGroup>
    </Section>
  );
}
