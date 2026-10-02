import { MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { IconButton, ListItem, Menu, MenuItem } from '../../ui';
import { shelfName, ShelfFace, timeLeft } from '../shelf';
import { binnedChat, type CharacterActions } from '../useCharacterActions';

type Props = {
  item: ChatSummary;
  // Its character's, or 캐릭터 없이.
  shelf: Shelf<ChatSummary>;
  // The step it is at while it is being removed for good.
  busy: string | null;
  actions: CharacterActions;
  // 지금 지우기 asks first.
  onPurge: () => void;
};

// A deleted chat in 휴지통, whose character is not deleted.
export function BinnedChat({ item, shelf, busy, actions, onPurge }: Props) {
  return (
    <ListItem
      leading={<ShelfFace shelf={shelf} />}
      title={item.title}
      description={shelfName(shelf)}
      aside={busy ?? timeLeft(item.chat)}
      trailing={
        busy === null && (
          <Menu place="below-end" label={`${item.title} 메뉴`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${item.title} 메뉴`} size="sm" {...opener} />}>
            <MenuItem icon={RotateCcw} label="되살리기" onClick={() => void actions.restore(binnedChat(item))} />
            <MenuItem icon={Trash2} label="지금 지우기" tone="warn" onClick={onPurge} />
          </Menu>
        )
      }
    />
  );
}
