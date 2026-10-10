import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Menu, type MenuHandle } from './Menu';

// The ⋯ of a screen's head or a row: what is done to the thing as a whole (사본 만들기, 기본으로 정하기, 삭제). dot: something
// inside needs a look; handle: another press, such as the row's own, opens it too.
export function MoreMenu({ label, dot, handle, children }: { label: string; dot?: boolean; handle?: MenuHandle; children: ReactNode }) {
  return (
    <Menu place="below-end" label={label} handle={handle} trigger={(opener) => <IconButton icon={MoreHorizontal} label={label} size="sm" dot={dot} {...opener} />}>
      {children}
    </Menu>
  );
}
