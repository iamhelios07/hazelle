import { SquarePen } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { ACTS } from '../../common/acts';
import { aliased } from '../../common/alias';
import { navigate } from '../../shell/router';
import { enterShelf } from '../../shell/routes';
import { FaceCard, MenuItem, MoreMenu, useMenuHandle, useMenuOpener, useWide } from '../../ui';
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
    <MoreMenu handle={handle} of={name}>
      {binned ? (
        <>
          <MenuItem icon={ACTS.restore.icon} label={ACTS.restore.label} onClick={() => actions.restore(binnedCharacter(shelf))} />
          <MenuItem icon={ACTS.remove.icon} label="영구 삭제" tone="warn" onClick={onPurge} />
        </>
      ) : (
        <>
          <MenuItem icon={SquarePen} label="편집" onClick={() => navigate({ kind: 'edit', character: shelf.id })} />
          <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void actions.copy(shelf)} />
          <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => actions.remove(shelf)} />
        </>
      )}
    </MoreMenu>
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
