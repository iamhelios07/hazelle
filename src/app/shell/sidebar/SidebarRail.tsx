import { LayoutGrid, MessageSquarePlus, PackageOpen, Settings, UserRoundPlus } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { ACTS, importOf, newOf } from '../../common/acts';
import { useImport } from '../../common/importing';
import { ShelfFace, shelfName } from '../../library/shelf';
import { useNewCharacter } from '../../library/useCharacterActions';
import { NO_CHARACTER, SETTINGS } from '../../common/words';
import { FaceButton, IconButton, Menu, MenuItem, Rail, Viewport } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';

type Props = {
  shelves: Shelf<ChatSummary>[];
  current: Shelf<ChatSummary> | undefined;
  home: boolean;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  fold: { open: boolean; onToggle: () => void } | undefined;
};

// On wide screens these places live only here; the list page shows them on phones.
export function SidebarRail({ shelves, current, home, typing, onEnter, fold }: Props) {
  const { pick, move } = useImport();
  const create = useNewCharacter();
  return (
    <Rail
      fold={fold}
      actions={
        <>
          <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" framed current={home} onClick={() => navigate(HOME)} />
          <Menu label="추가" trigger={(opener) => <IconButton icon={ACTS.create.icon} label="추가" framed {...opener} />}>
            <MenuItem icon={ACTS.import.icon} label={importOf('봇')} onClick={pick} />
            <MenuItem icon={UserRoundPlus} label={newOf('캐릭터')} onClick={create} />
            <MenuItem icon={PackageOpen} label="Risu에서 이사" onClick={move} />
            <MenuItem icon={MessageSquarePlus} label={`${NO_CHARACTER} 새 채팅`} onClick={() => navigate({ kind: 'new-chat', character: null })} />
          </Menu>
          <IconButton icon={Settings} label={SETTINGS} framed onClick={() => navigate(settingsEntry(true))} />
        </>
      }
    >
      <Viewport keys={shelves.map((shelf) => shelf.id ?? 'none')} variant="rail" current={current && (current.id ?? 'none')}>{(index) => {
        const shelf = shelves[index]!;
        return (
        <FaceButton key={shelf.id ?? 'none'} label={shelfName(shelf)} current={shelf === current} dot={typing(shelf)} onClick={() => onEnter(shelf)}>
          <ShelfFace shelf={shelf} size="rail" />
        </FaceButton>
        );
      }}</Viewport>
    </Rail>
  );
}
