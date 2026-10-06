import { Copy, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { aliased } from '../../common/alias';
import { navigate } from '../../shell/router';
import { enterShelf } from '../../shell/routes';
import { FaceCard, IconButton, Menu, MenuItem, useMenuHandle, useMenuOpener, useWide } from '../../ui';
import { binCardNote, cardNote } from '../shelf';
import { binnedCharacter, type CharacterActions } from '../useCharacterActions';

type Props = {
  shelf: CharacterShelf<ChatSummary>;
  binned: boolean;
  busy: string | null;
  // null while not picking.
  picked: boolean | null;
  onPick: () => void;
  actions: CharacterActions;
  onPurge: () => void;
};

export function CharacterCard({ shelf, binned, busy, picked, onPick, actions, onPurge }: Props) {
  const wide = useWide();
  const name = aliased(shelf.character.card.name, shelf.character.alias);
  const handle = useMenuHandle();
  const card = useMenuOpener(handle);
  const shows = picked === null && busy === null;
  const menu = (
    <Menu handle={handle} place="below-end" label={`${name} 메뉴`} trigger={(opener) => <IconButton icon={MoreHorizontal} label={`${name} 메뉴`} size="sm" {...opener} />}>
      {binned ? (
        <>
          <MenuItem icon={RotateCcw} label="되살리기" onClick={() => actions.restore(binnedCharacter(shelf))} />
          <MenuItem icon={Trash2} label="지금 지우기" tone="warn" onClick={onPurge} />
        </>
      ) : (
        <>
          <MenuItem icon={Pencil} label="편집" onClick={() => navigate({ kind: 'edit', character: shelf.id })} />
          <MenuItem icon={Copy} label="사본 만들기" onClick={() => void actions.copy(shelf)} />
          <MenuItem icon={Trash2} label="지우기" tone="warn" onClick={() => actions.remove(shelf)} />
        </>
      )}
    </Menu>
  );
  const press = picked !== null ? { onClick: onPick } : binned ? (shows ? card : { onClick: () => {} }) : { onClick: () => navigate(enterShelf(shelf, wide)) };
  return (
    <FaceCard
      image={shelf.face}
      name={name}
      note={busy ?? (binned ? binCardNote(shelf) : cardNote(shelf))}
      selected={picked}
      menu={shows ? menu : undefined}
      {...press}
    />
  );
}
