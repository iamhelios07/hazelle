import { MoreHorizontal } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { hasFinePointer } from '../foundation/media';
import { Menu, useMenuHandle, type MenuHandle } from './Menu';

// The ⋯ of a screen's head or a row: what is done to the thing as a whole (사본 만들기, 기본으로 정하기, 삭제), named
// '{of} 메뉴'. dot: something inside needs a look; handle: another press, such as the row's own, opens it too; size and
// place: a message's tools are xs, and open toward the story's roomier side (Menu's end).
export function MoreMenu({ of, dot, handle, size = 'sm', place = 'below-end', children }: { of: string; dot?: boolean; handle?: MenuHandle; size?: 'xs' | 'sm'; place?: 'below-end' | 'end'; children: ReactNode }) {
  const own = useMenuHandle();
  const menu = handle ?? own;
  const slot = useContext(MenuSlot);
  useEffect(() => {
    if (!slot) return;
    slot.current = menu;
    return () => {
      slot.current = null;
    };
  }, [slot, menu]);
  const label = `${of} 메뉴`;
  return (
    <Menu place={place} label={label} handle={menu} trigger={(opener) => <IconButton icon={MoreHorizontal} label={label} size={size} dot={dot} {...opener} />}>
      {children}
    </Menu>
  );
}

// A kit item of the user's things (a card, a folder, a list row) opens the ⋯ it holds on a right-click too, at the
// pointer. Only these: a message or a field keeps the browser's own menu for copying and spelling. With a mouse only,
// so a touch screen's long press stays the browser's.
export const MenuSlot = createContext<RefObject<MenuHandle | null> | null>(null);

export function useMenuSlot() {
  const held = useRef<MenuHandle | null>(null);
  const onContextMenu = (event: MouseEvent) => {
    const menu = held.current;
    // Already open, the right-click fell inside it (a press outside closed it first): the browser's.
    if (!menu || menu.read().open || !hasFinePointer()) return;
    event.preventDefault();
    menu.set({ open: true, from: null, at: { x: event.clientX, y: event.clientY } });
  };
  return { held, onContextMenu };
}
