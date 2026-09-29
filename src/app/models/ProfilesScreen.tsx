import { Plus } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { addProfile, modelProfile, profileUsers } from '../../runtime/profiles';
import { useStore, useViews } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, List, ListItem, NavBar, Screen, Text } from '../ui';

const NAMED = 2;

export function ProfilesScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const route = useRoute();
  const { profiles, connections, settings } = useViews();

  async function add() {
    const saved = await addProfile(store, { name: '새 묶음', settings: {} });
    if (!saved.ok) return toast.failed(saved, '묶음을 만들지 못했어요.');
    navigate({ kind: 'profile', id: saved.data.id });
  }

  const byName = (a: Stored<'profile'>, b: Stored<'profile'>) => a.value.name.localeCompare(b.value.name, 'ko');
  const sorted = [...profiles].sort((a, b) => Number(b.id === settings.profile) - Number(a.id === settings.profile) || byName(a, b));
  const lost = connections.flatMap((connection) => connection.value.starred.filter((model) => modelProfile(store, model).kind === 'missing').map((model) => model.name));

  function users(id: string) {
    const names = profileUsers(connections, settings.profile, id).map(({ model }) => model.name);
    if (!names.length) return '쓰는 모델 없음';
    const shown = names.slice(0, NAMED).join(' · ');
    return names.length > NAMED ? `${shown} 외 ${names.length - NAMED}개` : shown;
  }

  const actions = (
    <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add()}>
      새 묶음
    </Button>
  );
  return (
    <Screen top={<NavBar title="모델 설정" actions={actions} {...backBar(back)} />}>
      <Text size="sm" tone="muted">
        설정 묶음 하나를 여러 모델에 붙여 써요. 묶음이 따로 없는 모델은 기본 묶음을 써요.
      </Text>
      {lost.length > 0 && <Callout tone="warn">{`묶음이 지워진 모델: ${lost.join(', ')} · 묶음을 열어 다시 붙여 주세요.`}</Callout>}
      <List label="설정 묶음">
        {sorted.map(({ id, value }) => (
          <ListItem
            key={id}
            title={value.name}
            badge={settings.profile === id ? '기본' : undefined}
            description={users(id)}
            current={route.kind === 'profile' && route.id === id}
            onClick={() => navigate({ kind: 'profile', id })}
          />
        ))}
      </List>
    </Screen>
  );
}
