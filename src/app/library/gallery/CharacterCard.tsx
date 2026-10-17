import { Link2, SquarePen } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf } from '../../../model/library';
import { ACTS, exportOf } from '../../common/acts';
import { RISU_CHAT_FILE, SHARE } from '../../common/words';
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
  // The folder path, shown before the note where cards from every folder stand together.
  where?: string;
  // The card drags onto a folder.
  drag?: boolean;
};

export function CharacterCard({ shelf, binned, busy, picked, onPick, actions, onPurge, where, drag = false }: Props) {
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
          <CharacterActionItems shelf={shelf} actions={actions} />
        </>
      )}
    </MoreMenu>
  );
  const press = picked !== null ? { onClick: onPick } : binned ? (shows ? card : { onClick: () => {} }) : { onClick: () => navigate(enterShelf(shelf, wide)) };
  return (
    <FaceCard
      image={shelf.face}
      name={name}
      note={busy ?? (binned ? binCardNote(shelf) : where ? `${where} · ${cardNote(shelf)}` : cardNote(shelf))}
      selected={picked}
      menu={shows ? menu : undefined}
      drag={drag ? shelf.id : undefined}
      {...press}
    />
  );
}

export function CharacterActionItems({ shelf, actions, disabled, onRemoved }: { shelf: CharacterShelf<ChatSummary>; actions: CharacterActions; disabled?: boolean; onRemoved?: () => void }) {
  return (
    <>
      <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} disabled={disabled} onClick={() => void actions.copy(shelf)} />
      <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} disabled={disabled} onClick={() => actions.exportFile(shelf)} />
      <MenuItem icon={ACTS.export.icon} label={exportOf(RISU_CHAT_FILE)} disabled={disabled} onClick={() => actions.exportChats(shelf)} />
      <MenuItem icon={Link2} label={SHARE.act} disabled={disabled} onClick={() => actions.share(shelf)} />
      <MenuItem
        icon={ACTS.remove.icon}
        label={ACTS.remove.label}
        tone="warn"
        disabled={disabled}
        onClick={() => {
          actions.remove(shelf);
          onRemoved?.();
        }}
      />
    </>
  );
}
