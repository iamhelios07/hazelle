import { Import, LayoutGrid, Settings } from 'lucide-react';
import type { ChatItem } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { useImport } from '../../library/ImportFlow';
import { ShelfFace, shelfName } from '../../library/shelf';
import { SETTINGS } from '../../common/words';
import { FaceButton, IconButton, Rail } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { settingsEntry } from '../settings/SettingsNav';

type Props = {
  shelves: Shelf<ChatItem>[];
  current: Shelf<ChatItem> | undefined;
  typing: (shelf: Shelf<ChatItem>) => boolean;
  onEnter: (shelf: Shelf<ChatItem>) => void;
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
