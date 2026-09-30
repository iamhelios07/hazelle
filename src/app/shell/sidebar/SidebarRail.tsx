import { Import, LayoutGrid, Settings } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { useImport } from '../../library/ImportFlow';
import { ShelfFace, shelfName } from '../../library/shelf';
import { SETTINGS } from '../../common/words';
import { FaceButton, IconButton, Rail } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';

type Props = {
  shelves: Shelf<ChatSummary>[];
  current: Shelf<ChatSummary> | undefined;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  onExpand: () => void;
};

export function SidebarRail({ shelves, current, typing, onEnter, onExpand }: Props) {
  const { pick } = useImport();
  return (
    <Rail
      onExpand={onExpand}
      actions={
        <>
          <IconButton icon={Import} label="봇 가져오기" onClick={pick} />
          <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" onClick={() => navigate(HOME)} />
        </>
      }
      footer={<IconButton icon={Settings} label={SETTINGS} onClick={() => navigate(settingsEntry(true))} />}
    >
      {shelves.map((shelf) => (
        <FaceButton key={shelf.id ?? 'none'} label={shelfName(shelf)} current={shelf === current} dot={typing(shelf) ? 'accent' : undefined} onClick={() => onEnter(shelf)}>
          <ShelfFace shelf={shelf} />
        </FaceButton>
      ))}
    </Rail>
  );
}
