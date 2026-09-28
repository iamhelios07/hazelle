import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './SideRow.module.css';

type ChatProps = {
  avatar: ReactNode;
  title: string;
  // Replaced by 쓰는 중 while a reply is being written.
  time: string;
  typing: boolean;
  preview: string;
  current: boolean;
  onClick: () => void;
};

// One chat in the sidebar list.
export function ChatRow({ avatar, title, time, typing, preview, current, onClick }: ChatProps) {
  return (
    <button type="button" className={current ? `${styles.chat} ${styles.current}` : styles.chat} aria-current={current || undefined} onClick={onClick}>
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
