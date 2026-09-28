import { ChevronLeft, ChevronRight, Scissors, Square, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Message.module.css';

type Props = {
  avatar: ReactNode;
  name: string;
  time: string;
  // The user's own words sit in a box; replies run as the story.
  mine: boolean;
  children: ReactNode;
  // Under the body: a cut marker, the version switcher.
  after?: ReactNode;
  // Shown on hover, or on phones after a tap on the message (pinned).
  tools?: ReactNode;
  pinned: boolean;
  onTap: () => void;
};

export function Message({ avatar, name, time, mine, children, after, tools, pinned, onTap }: Props) {
  // Phones have no hover, so a tap on the message itself shows its tools (design F3).
  const tap = (event: MouseEvent) => {
    if (!matchMedia('(hover: none)').matches || (event.target as HTMLElement).closest('button, a, textarea')) return;
    onTap();
  };
  return (
    <article className={pinned ? `${styles.message} ${styles.pinned}` : styles.message} onClick={tap}>
      {avatar}
      <div className={styles.main}>
        <div className={styles.head}>
          <span className={mine ? styles.me : styles.name}>{name}</span>
          <span className={styles.time}>{time}</span>
        </div>
        {mine ? <div className={styles.bubble}>{children}</div> : children}
        {after}
      </div>
      {tools && <div className={styles.tools}>{tools}</div>}
    </article>
  );
}

export function Tool({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.tool} aria-label={label} title={label} onClick={onClick}>
      <Icon icon={icon} size="xs" />
    </button>
  );
}

export function ToolDivider() {
  return <span className={styles.toolDivider} />;
}

// The reply is on its way and no text has come yet.
export function Waiting() {
  return (
    <span className={styles.waiting} aria-label="답장을 기다리는 중">
      <span />
      <span />
      <span />
    </span>
  );
}

type SwitcherProps = {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  // On the last version, → asks for a new one.
  nextLabel: string;
  // With the keys that press them (src/app/shortcuts.ts).
  prevTitle: string;
  nextTitle: string;
};

// ← n / m → between a message's versions.
export function Switcher({ label, onPrev, onNext, prevDisabled, nextDisabled, nextLabel, prevTitle, nextTitle }: SwitcherProps) {
  return (
    <div className={styles.switcher}>
      <button type="button" className={styles.step} aria-label="이전" title={prevTitle} disabled={prevDisabled} onClick={onPrev}>
        <Icon icon={ChevronLeft} size="xs" />
      </button>
      <span className={styles.count}>{label}</span>
      <button type="button" className={styles.step} aria-label={nextLabel} title={nextTitle} disabled={nextDisabled} onClick={onNext}>
        <Icon icon={ChevronRight} size="xs" />
      </button>
    </div>
  );
}

type MarkerProps = { reason: 'length' | 'stopped'; label: string; action?: { label: string; disabled: boolean; onClick: () => void } };

// A reply that did not end cleanly says so, quietly, under its text (design F3).
export function Marker({ reason, label, action }: MarkerProps) {
  return (
    <div className={reason === 'stopped' ? `${styles.marker} ${styles.stopped}` : styles.marker}>
      <Icon icon={reason === 'length' ? Scissors : Square} size="xs" />
      <span>{action ? `${label} ·` : label}</span>
      {action && (
        <button type="button" className={styles.link} disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// A reply that failed, in place of its text.
export function Failure({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className={styles.failure} role="alert">
      <span className={styles.failureTitle}>
        <Icon icon={TriangleAlert} size="xs" />
        {title}
      </span>
      <p className={styles.failureText}>{children}</p>
      <div className={styles.failureActions}>{actions}</div>
    </div>
  );
}
