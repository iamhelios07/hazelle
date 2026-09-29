import type { Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { addProfile, modelProfile, setModelProfile } from '../../runtime/profiles';
import { useStore, useViews } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { ChipButton, Divider, Empty, List, ListItem, Menu, MenuItem, NavBar, Screen, Section, Text } from '../ui';

// Model first (user, 2026-09-29: "묶음 유지, 모델 중심 화면"): every starred model with the 설정 묶음 it uses, which the
// screens call its 설정. The rows of the models sharing the open 묶음 are all marked, so they read as changing together.
export function ProfilesScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const route = useRoute();
  const { profiles, connections, settings } = useViews();
  const open = route.kind === 'profile' ? route.id : null;

  const models = connections.flatMap((connection) => connection.value.starred.map((model) => ({ connection, model, choice: modelProfile(store, model) })));
  const unused = profiles.filter((profile) => !models.some(({ choice }) => choice.kind === 'profile' && choice.profile.id === profile.id));
  const sorted = [...profiles].sort((a, b) => Number(b.id === settings.profile) - Number(a.id === settings.profile) || a.value.name.localeCompare(b.value.name, 'ko'));

  // The default is what a model without its own uses, so picking it clears the model's own.
  async function choose(connection: string, model: string, id: string) {
    const saved = await setModelProfile(store, connection, model, id === settings.profile ? null : id);
    if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
  }

  // A copy of what the model uses now, so only the values changed afterwards differ.
  async function own(connection: string, model: Starred, from: Stored<'profile'> | null) {
    const made = await addProfile(store, { name: `${model.name}용`, settings: from?.value.settings ?? {} });
    if (!made.ok) return toast.failed(made, '설정을 만들지 못했어요.');
    const saved = await setModelProfile(store, connection, model.id, made.data.id);
    if (!saved.ok) return toast.failed(saved, '바꾸지 못했어요.');
    navigate({ kind: 'profile', id: made.data.id });
  }

  return (
    <Screen top={<NavBar title="모델 설정" {...backBar(back)} />}>
      <Text size="sm" tone="muted">
        같은 설정을 쓰는 모델은 함께 바뀌어요. 새로 별표한 모델은 기본 설정을 써요.
      </Text>
      {models.length > 0 ? (
        <List label="모델">
          {models.map(({ connection, model, choice }) => {
            const current = choice.kind === 'profile' ? choice.profile : null;
            return (
              <ListItem
                key={`${connection.id}/${model.id}`}
                title={model.name}
                tags={[connection.value.label]}
                current={current !== null && current.id === open}
                onClick={() => navigate(current ? { kind: 'profile', id: current.id } : { kind: 'profiles' })}
                control={
                  <Menu
                    place="below-end"
                    label={`${model.name}의 설정`}
                    trigger={(opener) => <ChipButton tone={current ? 'default' : 'warn'} label={current ? current.value.name : '없음'} title={`${model.name}의 설정`} {...opener} />}
                  >
                    {sorted.map((profile) => (
                      <MenuItem
                        key={profile.id}
                        label={profile.value.name}
                        tag={profile.id === settings.profile ? '기본' : undefined}
                        checked={profile.id === current?.id}
                        onClick={() => void choose(connection.id, model.id, profile.id)}
                      />
                    ))}
                    <Divider variant="menu" />
                    <MenuItem label="이 모델만 따로 설정하기" onClick={() => void own(connection.id, model, current)} />
                  </Menu>
                }
              />
            );
          })}
        </List>
      ) : (
        <Empty variant="section">별표한 모델이 없어요. 연결에서 모델에 별표를 찍으면 여기서 설정할 수 있어요.</Empty>
      )}
      {unused.length > 0 && (
        <Section title="쓰는 모델이 없는 설정">
          <List label="쓰는 모델이 없는 설정">
            {unused.map((profile) => (
              <ListItem key={profile.id} title={profile.value.name} current={profile.id === open} onClick={() => navigate({ kind: 'profile', id: profile.id })} />
            ))}
          </List>
        </Section>
      )}
    </Screen>
  );
}
