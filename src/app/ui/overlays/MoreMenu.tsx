import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Menu, type MenuHandle } from './Menu';

// The ⋯ of a screen's head or a row: what is done to the thing as a whole (사본 만들기, 기본으로 정하기, 삭제), named
// '{of} 메뉴'. dot: something inside needs a look; handle: another press, such as the row's own, opens it too; size and
// place: a message's tools are xs, and open toward the story's roomier side (Menu's end).
export function MoreMenu({ of, dot, handle, size = 'sm', place = 'below-end', children }: { of: string; dot?: boolean; handle?: MenuHandle; size?: 'xs' | 'sm'; place?: 'below-end' | 'end'; children: ReactNode }) {
  const label = `${of} 메뉴`;
  return (
    <Menu place={place} label={label} handle={handle} trigger={(opener) => <IconButton icon={MoreHorizontal} label={label} size={size} dot={dot} {...opener} />}>
      {children}
    </Menu>
  );
}
