import { Copy, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import type { ChatItem } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { navigate } from '../../shell/router';
import { enterShelf } from '../../shell/routes';
import { FaceCard, IconButton, MenuItem, Popover, useWide } from '../../ui';
import { binCardNote, cardNote } from '../shelf';
import type { CharacterActions } from '../useCharacterActions';

type Props = {
  shelf: CharacterShelf<ChatItem>;
  // In 지운 캐릭터: it can be brought back or removed for good, and a press opens its menu.
  binned: boolean;
  // The step it is at while it is being copied or removed for good.
  busy: string | null;
  // Whether it is picked to move, or null while not picking.
  picked: boolean | null;
  onPick: () => void;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  actions: CharacterActions;
  // 지금 지우기 asks first.
  onPurge: () => void;
};

export function CharacterCard({ shelf, binned, busy, picked, onPick, menuOpen, onMenu, actions, onPurge }: Props) {
  const wide = useWide();
  const { name } = shelf.character.card;
  const closing = (act: () => void) => () => {
    onMenu(false);
    act();
  };
  const menu = (
    <Popover
      open={menuOpen}
      onClose={() => onMenu(false)}
      place="below-end"
      label={`${name} 메뉴`}
      trigger={<IconButton icon={MoreHorizontal} label={`${name} 메뉴`} size="sm" expanded={menuOpen} onClick={() => onMenu(!menuOpen)} />}
    >
      {binned ? (
        <>
          <MenuItem icon={RotateCcw} label="되살리기" onClick={closing(() => void actions.restore(shelf))} />
          <MenuItem icon={Trash2} label="지금 지우기" tone="warn" onClick={closing(onPurge)} />
        </>
      ) : (
        <>
          <MenuItem icon={Copy} label="사본 만들기" onClick={closing(() => void actions.copy(shelf))} />
          <MenuItem icon={Trash2} label="지우기" tone="warn" onClick={closing(() => void actions.remove(shelf))} />
        </>
      )}
    </Popover>
  );
  return (
    <FaceCard
      image={shelf.face}
      name={name}
      note={busy ?? (binned ? binCardNote(shelf) : cardNote(shelf))}
      selected={picked}
      onClick={() => (picked !== null ? onPick() : binned ? onMenu(true) : navigate(enterShelf(shelf, wide)))}
      menu={picked !== null || busy !== null ? undefined : menu}
    />
  );
}
