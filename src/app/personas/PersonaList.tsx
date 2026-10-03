import { Plus } from 'lucide-react';
import { addPersona } from '../../runtime/personas';
import { aliased } from '../common/alias';
import type { Frame } from '../common/frame';
import { usePersonas, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { PAGES } from '../common/words';
import { Avatar, Button, List, ListItem } from '../ui';

type Props = {
  onPick: (id: string) => void;
  current?: string;
  inUse?: string;
  frame: Frame;
};

export function PersonaList({ onPick, current, inUse, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const personas = usePersonas();
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
          title={aliased(value.name, value.alias)}
          tags={[...(settings.persona === id ? ['기본'] : []), ...(inUse === id ? ['사용 중'] : [])]}
          description={value.description}
          current={current === id}
          onClick={() => onPick(id)}
        />
      ))}
    </List>
  );
  return frame({ head: { title: PAGES.personas, actions }, body });
}
