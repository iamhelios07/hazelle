import { Plus } from 'lucide-react';
import { addPersona } from '../../runtime/personas';
import { useSettings, useStore, useViews } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Button, List, ListItem, NavBar, Screen } from '../ui';

export function PersonasScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const { personas } = useViews();
  const settings = useSettings();
  const route = useRoute();

  async function add() {
    const saved = await addPersona(store, { name: '새 페르소나', description: '', picture: null });
    if (!saved.ok) return toast.failed(saved, '페르소나를 만들지 못했어요.');
    navigate({ kind: 'persona', id: saved.data.id });
  }

  return (
    <Screen
      top={
        <NavBar
          title="페르소나"
          {...backBar(back)}
          actions={
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add()}>
              새 페르소나
            </Button>
          }
        />
      }
    >
      <List label="페르소나">
        {personas.map(({ id, value }) => (
          <ListItem
            key={id}
            leading={<Avatar face={value.name} image={value.picture} tone="you" />}
            title={value.name}
            tags={settings.persona === id ? ['기본'] : []}
            description={value.description}
            current={route.kind === 'persona' && route.id === id}
            onClick={() => navigate({ kind: 'persona', id })}
          />
        ))}
      </List>
    </Screen>
  );
}
