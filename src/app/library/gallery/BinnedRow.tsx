import { MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Mark } from '../../../model/library';
import { IconButton, ListItem, Menu, MenuItem } from '../../ui';
import { timeLeft } from '../shelf';
import type { Binned, CharacterActions } from '../useCharacterActions';

type Props = {
  item: Binned;
  face?: ReactNode;
  description?: string;
  mark: Mark;
  busy: string | null;
  actions: CharacterActions;
  onPurge: () => void;
};

export function BinnedRow({ item, face, description, mark, busy, actions, onPurge }: Props) {
  return (
    <ListItem
      leading={face}
      title={item.name}
      description={description}
      aside={busy ?? timeLeft(mark)}
      trailing={
        busy === null && (
          <Menu place="below-end" label={`${item.name} 메뉴`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${item.name} 메뉴`} size="sm" {...opener} />}>
            <MenuItem icon={RotateCcw} label="되살리기" onClick={() => actions.restore(item)} />
            <MenuItem icon={Trash2} label="지금 지우기" tone="warn" onClick={onPurge} />
          </Menu>
        )
      }
    />
  );
}
