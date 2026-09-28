import { Check, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Icon } from '../foundation/Icon';
import { useLayer } from './layers';
import styles from './Menu.module.css';

// What a menu hands a button that opens it, spread onto an IconButton, Button, ChipButton or FaceCard.
export type MenuOpener = { ref: RefObject<HTMLButtonElement | null>; popup: 'menu'; expanded: boolean; onClick: () => void };

type State = { open: boolean; from: HTMLElement | null };
const CLOSED: State = { open: false, from: null };

// A menu's open state and the button that opened it, kept apart from the menu so buttons elsewhere open it and show
// whether it is open too, such as a card in 지운 캐릭터 or a failed reply's 다른 모델로.
export type MenuHandle = { read: () => State; subscribe: (listener: () => void) => () => void; set: (state: State) => void };

function menuHandle(): MenuHandle {
  let state = CLOSED;
  const listeners = new Set<() => void>();
  return {
    read: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      state = next;
      listeners.forEach((listener) => listener());
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
  // Which corner of the trigger it opens from, and which way.
  place?: 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'beside';
  size?: 'md' | 'lg';
  // For a menu that other buttons open too; without one it keeps its own.
  handle?: MenuHandle;
  children: ReactNode;
};

const CloseMenu = createContext(() => {});

// One menu is open at a time: opening one closes the other, as a press outside it would. Only keys reach another
// menu's button while one is open.
let shown: (() => void) | null = null;

// Every menu opened from a button. An item closes it. Esc and an item give the focus back to the button that opened
// it, or to the menu's own button when that one has gone.
export function Menu({ label, trigger, place = 'below-start', size = 'md', handle, children }: Props) {
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
    if (open) panel.current?.querySelector<HTMLElement>('input, [role^="menuitem"], button')?.focus();
  }, [open]);

  // Before paint, so two menus are never drawn at once.
  useLayoutEffect(() => {
    if (!open) return;
    shown?.();
    const hide = () => menu.set(CLOSED);
    shown = hide;
    return () => {
      if (shown === hide) shown = null;
    };
  }, [open, menu]);

  // A menu that would cross the screen's side moves back inside it, whichever corner it opens from,
  // before it is painted.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(element).getPropertyValue('--menu-edge'));
    const room = document.documentElement.clientWidth;
    const shift = box.left < edge ? edge - box.left : box.right > room - edge ? room - edge - box.right : 0;
    element.style.setProperty('--nudge', `${shift}px`);
  }, [open]);

  return (
    <div className={styles.anchor} ref={anchor}>
      {trigger(opener)}
      {open && (
        <div ref={panel} className={`${styles.menu} ${styles[place]} ${styles[size]}`} role="menu" aria-label={label}>
          <CloseMenu.Provider value={() => close(true)}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  label: string;
  sub?: string;
  hint?: string;
  icon?: LucideIcon;
  // Makes the item one of a set of choices, checked when it is the current one.
  checked?: boolean;
  tone?: 'default' | 'muted' | 'warn';
  disabled?: boolean;
  onClick: () => void;
};

// The menu closes before onClick runs, so a dialog it opens takes the button that opened the menu as the place to
// give the focus back to.
export function MenuItem({ label, sub, hint, icon, checked, tone = 'default', disabled = false, onClick }: ItemProps) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={tone === 'default' ? styles.item : `${styles.item} ${styles[tone]}`}
      disabled={disabled}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {icon && <Icon icon={icon} size="xs" />}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {hint && <span className={styles.hint}>{hint}</span>}
      {checked && (
        <span className={styles.check}>
          <Icon icon={Check} size="xs" />
        </span>
      )}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <span className={styles.heading}>{children}</span>;
}

// A line of text inside a menu, such as an empty search.
export function MenuNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
