import { Check, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { ChangeSignal } from '../../../change-signal';
import { Item } from '../collections/Item';
import { ButtonSlot } from '../controls/Button';
import { Icon } from '../foundation/Icon';
import { faceStyle, type FontId } from '../foundation/fonts';
import { keepOnScreen, useLayer } from './layers';
import styles from './Menu.module.css';

export type MenuOpener = { ref: RefObject<HTMLButtonElement | null>; popup: 'menu' | 'dialog'; expanded: boolean; onClick: () => void };

type State = { open: boolean; from: HTMLElement | null };
const CLOSED: State = { open: false, from: null };

export type MenuHandle = { read: () => State; subscribe: (listener: () => void) => () => void; set: (state: State) => void };

function menuHandle(): MenuHandle {
  let state = CLOSED;
  const changes = new ChangeSignal();
  return {
    read: () => state,
    subscribe: changes.subscribe,
    set: (next) => {
      state = next;
      changes.notify();
    },
  };
}

export function useMenuHandle() {
  return useState(menuHandle)[0];
}

export function useMenuOpener(handle: MenuHandle): MenuOpener {
  const ref = useRef<HTMLButtonElement>(null);
  const { open } = useSyncExternalStore(handle.subscribe, handle.read);
  return { ref, popup: 'menu', expanded: open, onClick: () => handle.set(handle.read().open ? CLOSED : { open: true, from: ref.current }) };
}

type Props = {
  label: string;
  trigger: (opener: MenuOpener) => ReactNode;
  // end: below or above, whichever half of the window the button is not in, for a button that can sit anywhere in a
  // scrolling story, where the screen's head or the composer would cover a menu opened the fixed way.
  place?: 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'end';
  size?: 'md' | 'lg' | 'form';
  // dialog: a small form opened and closed like a menu, such as the chat's 작가의 노트; useMenuClose closes it.
  kind?: 'menu' | 'dialog';
  handle?: MenuHandle;
  children: ReactNode;
};

const CloseMenu = createContext(() => {});

// One menu is open at a time, apart from the menus a menu opens inside itself, such as a choice in a small form:
// opening one closes every other that does not hold it, as a press outside would. Only keys reach another menu's
// button while one is open.
let shown: (() => void)[] = [];
const Holders = createContext<readonly (() => void)[]>([]);

export function Menu({ label, trigger, place = 'below-start', size = 'md', kind = 'menu', handle, children }: Props) {
  const own = useMenuHandle();
  const menu = handle ?? own;
  const { open, from } = useSyncExternalStore(menu.subscribe, menu.read);
  const opener = useMenuOpener(menu);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    menu.set(CLOSED);
    if (refocus) (from?.isConnected ? from : opener.ref.current)?.focus();
  };
  // A press on the button that opened it is not outside, so that button closes it again like the menu's own does.
  useLayer(open, { outside: (target) => !anchor.current?.contains(target) && !from?.contains(target), close });

  // A menu that is not on the page is closed, so no button elsewhere shows it open.
  useEffect(() => () => menu.set(CLOSED), [menu]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('input, textarea, [role^="menuitem"], button')?.focus();
  }, [open]);

  const holders = useContext(Holders);
  const hide = useMemo(() => () => menu.set(CLOSED), [menu]);
  const held = useMemo(() => [...holders, hide], [holders, hide]);
  // Before paint, so two menus are never drawn at once.
  useLayoutEffect(() => {
    if (!open) return;
    for (const other of shown.filter((each) => !holders.includes(each))) other();
    shown = [...shown, hide];
    return () => {
      shown = shown.filter((each) => each !== hide);
    };
  }, [open, holders, hide]);

  const [upward, setUpward] = useState(false);
  useLayoutEffect(() => {
    if (open && place === 'end') {
      const { top, bottom } = anchor.current!.getBoundingClientRect();
      setUpward(top + bottom > window.innerHeight);
    }
  }, [open, place]);
  const side = place === 'end' ? (upward ? 'above-end' : 'below-end') : place;

  // A menu taller than the room on its side scrolls within that room instead of running off the screen.
  useLayoutEffect(() => {
    if (!panel.current) return;
    keepOnScreen(panel.current);
    const box = panel.current.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(panel.current).getPropertyValue('--menu-edge'));
    panel.current.style.setProperty('--room', `${side.startsWith('above') ? box.bottom - edge : window.innerHeight - box.top - edge}px`);
  }, [open, side]);

  return (
    <div className={styles.anchor} ref={anchor}>
      {trigger({ ...opener, popup: kind })}
      {open && (
        <div ref={panel} className={`${styles.menu} ${styles[side]} ${styles[size]} ${kind === 'dialog' ? styles.dialog : ''}`} role={kind} aria-label={label}>
          <Holders.Provider value={held}>
            <CloseMenu.Provider value={() => close(true)}>
              <ButtonSlot value={null}>{children}</ButtonSlot>
            </CloseMenu.Provider>
          </Holders.Provider>
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  label: string;
  sub?: string;
  // face: the label drawn in that font.
  face?: FontId;
  icon?: LucideIcon;
  avatar?: ReactNode;
  tag?: ReactNode;
  checked?: boolean;
  multiple?: boolean;
  tone?: 'default' | 'muted' | 'warn';
  disabled?: boolean;
  onClick: () => void;
};

// The menu closes before onClick runs, so a dialog it opens takes the button that opened the menu as the place to
// give the focus back to.
export function MenuItem({ label, sub, face, icon, avatar, tag, checked, multiple, tone, disabled, onClick }: ItemProps) {
  const close = useContext(CloseMenu);
  return (
    <Item
      density="compact"
      scheme="list"
      role={checked === undefined ? 'menuitem' : multiple ? 'menuitemcheckbox' : 'menuitemradio'}
      checked={checked}
      tone={tone}
      disabled={disabled}
      leading={avatar ?? (icon && <Icon icon={icon} size="xs" />)}
      title={face === undefined ? label : <span className={styles.face} style={faceStyle(face)}>{label}</span>}
      meta={tag}
      preview={sub}
      trailing={
        checked && (
          <span className={styles.check}>
            <Icon icon={Check} size="xs" />
          </span>
        )
      }
      onClick={() => {
        close();
        onClick();
      }}
    />
  );
}

export const useMenuClose = () => useContext(CloseMenu);

export function MenuHeading({ children }: { children: ReactNode }) {
  return <span className={styles.heading}>{children}</span>;
}
