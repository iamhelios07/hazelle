import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { addPersona } from '../../runtime/personas';
import { useSettings, useStore, useViews } from '../session';
import { useToast } from '../toast';
import { Avatar, Button, List, ListItem, type NavBarProps } from '../ui';

type Props = {
  // A new persona is picked as soon as it is made.
  onPick: (id: string) => void;
  // Open beside the list (ListDetail).
  current?: string;
  // The one a chat uses, marked 사용 중.
  inUse?: string;
  frame: (parts: { head: NavBarProps; body: ReactNode }) => ReactNode;
};

export function PersonaList({ onPick, current, inUse, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const { personas } = useViews();
  const settings = useSettings();

  async function add() {
    const saved = await addPersona(store, { name: '새 페르소나', description: '', picture: null });
    if (!saved.ok) return toast.failed(saved, '페르소나를 만들지 못했어요.');
    onPick(saved.data.id);
  }

  const actions = (
    <Button variant="secondary" size="sm" icon={Plus} onClick={() => void add()}>
      새 페르소나
    </Button>
  );
  const body = (
    <List label="페르소나">
      {personas.map(({ id, value }) => (
        <ListItem
          key={id}
          leading={<Avatar face={value.name} image={value.picture} tone="you" />}
          title={value.name}
          tags={[...(settings.persona === id ? ['기본'] : []), ...(inUse === id ? ['사용 중'] : [])]}
          description={value.description}
          current={current === id}
          onClick={() => onPick(id)}
        />
      ))}
    </List>
  );
  return frame({ head: { title: '페르소나', actions }, body });
}
