import { Import, LayoutGrid, PackageOpen, Settings } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { useImport } from '../../library/ImportFlow';
import { ShelfFace, shelfName } from '../../library/shelf';
import { SETTINGS } from '../../common/words';
import { FaceButton, IconButton, Rail, Viewport } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';

type Props = {
  shelves: Shelf<ChatSummary>[];
  current: Shelf<ChatSummary> | undefined;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  open: boolean;
  onToggle: () => void;
};

// On wide screens these places live only here; the panel beside the rail shows them on phones.
export function SidebarRail({ shelves, current, typing, onEnter, open, onToggle }: Props) {
  const { pick, move } = useImport();
  return (
    <Rail
      open={open}
      onToggle={onToggle}
      actions={
        <>
          <IconButton icon={Import} label="봇 가져오기" onClick={pick} />
          <IconButton icon={PackageOpen} label="Risu에서 이사" onClick={move} />
          <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" onClick={() => navigate(HOME)} />
        </>
      }
      footer={<IconButton icon={Settings} label={SETTINGS} onClick={() => navigate(settingsEntry(true))} />}
    >
      <Viewport keys={shelves.map((shelf) => shelf.id ?? 'none')} variant="rail" current={current && (current.id ?? 'none')}>{(index) => {
        const shelf = shelves[index]!;
        return (
        <FaceButton key={shelf.id ?? 'none'} label={shelfName(shelf)} current={shelf === current} dot={typing(shelf) ? 'accent' : undefined} onClick={() => onEnter(shelf)}>
          <ShelfFace shelf={shelf} />
        </FaceButton>
        );
      }}</Viewport>
    </Rail>
  );
}
