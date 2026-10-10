import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Menu } from './Menu';

// The ⋯ of a screen's head or a row: what is done to the thing as a whole (사본 만들기, 기본으로 정하기, 삭제).
export function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu place="below-end" label={label} trigger={(opener) => <IconButton icon={MoreHorizontal} label={label} size="sm" {...opener} />}>
      {children}
    </Menu>
  );
}
