import { modelProfile, profileUsers } from '../../runtime/profiles';
import { useStore, useViews } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import { noStarred, PAGES } from '../common/words';
import type { Back } from '../shell/routes';
import { Empty, List, ListItem, NavBar, Screen, Section } from '../ui';
import { defaultFirst, valueWords } from './settingWords';

// Models first, each opening its own page where it picks its settings; the settings made so far are listed under
// them. The screens never say 묶음.
export function ProfilesScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const route = useRoute();
  const { profiles, connections, settings } = useViews();

  const models = connections.flatMap((connection) => connection.value.starred.map((model) => ({ connection, model, choice: modelProfile(store, model) })));
  const sorted = defaultFirst(profiles, settings.profile);

  return (
    <Screen top={<NavBar title={PAGES.profiles} {...backBar(back)} />}>
      <Section title="모델" hint="새로 별표한 모델은 기본 설정을 써요.">
        {models.length > 0 ? (
          <List label="모델">
            {models.map(({ connection, model, choice }) => (
              <ListItem
                key={`${connection.id}/${model.id}`}
                title={model.name}
                tags={[connection.value.label]}
                aside={choice.kind === 'profile' ? choice.profile.value.name : '설정 없음'}
                current={route.kind === 'model' && route.connection === connection.id && route.model === model.id}
                onClick={() => navigate({ kind: 'model', connection: connection.id, model: model.id })}
              />
            ))}
          </List>
        ) : (
          <Empty variant="section">{noStarred('설정할 수 있어요')}</Empty>
        )}
      </Section>
      <Section title="만들어 둔 설정">
        <List label="만들어 둔 설정">
          {sorted.map((profile) => {
            const words = valueWords(profile.value.settings);
            return (
              <ListItem
                key={profile.id}
                title={profile.value.name}
                badge={profile.id === settings.profile ? '기본' : undefined}
                description={words.length ? words.join(' · ') : '정한 값 없음'}
                aside={`모델 ${profileUsers(connections, settings.profile, profile.id).length}개`}
                current={route.kind === 'profile' && route.id === profile.id}
                onClick={() => navigate({ kind: 'profile', id: profile.id })}
              />
            );
          })}
        </List>
      </Section>
    </Screen>
  );
}
