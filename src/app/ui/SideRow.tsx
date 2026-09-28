import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './SideRow.module.css';

type ItemProps = {
  // A character's face. A chat inside a character has none.
  avatar?: ReactNode;
  title: string;
  // Replaced by 쓰는 중 while a reply is being written.
  time: string;
  typing: boolean;
  preview: string;
  current: boolean;
  onClick: () => void;
};

// One character, or one of a character's chats, in the sidebar list.
export function ItemRow({ avatar, title, time, typing, preview, current, onClick }: ItemProps) {
  return (
    <button type="button" className={current ? `${styles.item} ${styles.current}` : styles.item} aria-current={current || undefined} onClick={onClick}>
      {avatar}
      <span className={styles.text}>
        <span className={styles.line}>
          <span className={styles.title}>{title}</span>
          <span className={typing ? `${styles.time} ${styles.typing}` : styles.time}>{typing ? '쓰는 중' : time}</span>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}

type FolderProps = { name: string; count: number; open: boolean; onToggle: () => void; children: ReactNode };

// A folder of characters; its rows sit under it while it is open.
export function FolderRow({ name, count, open, onToggle, children }: FolderProps) {
  return (
    <div className={styles.folder}>
      <button type="button" className={styles.folderHead} aria-expanded={open} onClick={onToggle}>
        <Icon icon={open ? ChevronDown : ChevronRight} size="xs" />
        <span className={styles.label}>{name}</span>
        <span className={styles.count}>{count}</span>
      </button>
      {open && <div className={styles.folderItems}>{children}</div>}
    </div>
  );
}

// The character whose chats the list shows. With onOpen, its face and name open the character's own
// page; on phones the list is that page.
export function SideTitle({ avatar, name, onOpen, children }: { avatar: ReactNode; name: string; onOpen?: () => void; children?: ReactNode }) {
  const title = (
    <>
      {avatar}
      <span className={styles.heading}>{name}</span>
    </>
  );
  return (
    <div className={styles.sideTitle}>
      {onOpen ? (
        <button type="button" className={`${styles.titleBox} ${styles.titleButton}`} onClick={onOpen}>
          {title}
        </button>
      ) : (
        <span className={styles.titleBox}>{title}</span>
      )}
      {children}
    </div>
  );
}

type NavProps = { icon: LucideIcon; label: string; note?: string; current?: boolean; onClick: () => void };

// A place in the app, at the foot of the sidebar.
export function NavRow({ icon, label, note, current = false, onClick }: NavProps) {
  return (
    <button type="button" className={current ? `${styles.nav} ${styles.current}` : styles.nav} aria-current={current || undefined} onClick={onClick}>
      <Icon icon={icon} size="xs" />
      <span className={styles.label}>{label}</span>
      {note && <span className={styles.note}>{note}</span>}
    </button>
  );
}

// A line in the list where rows would be, such as an empty search.
export function SideNote({ children }: { children: ReactNode }) {
  return <p className={styles.sideNote}>{children}</p>;
}

// Who is signed in, with their controls.
export function AccountRow({ avatar, name, children }: { avatar: ReactNode; name: string; children: ReactNode }) {
  return (
    <div className={styles.account}>
      {avatar}
      <span className={styles.name}>{name}</span>
      {children}
    </div>
  );
}
