import { ChevronLeft, ChevronRight, Languages, Scissors, Square, TriangleAlert } from 'lucide-react';
import { useContext, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { useHover } from '../foundation/media';
import { Menu, MenuItem } from '../overlays/Menu';
import { RowMemoryContext } from '../collections/row-memory';
import { StoryGutterContext } from '../layout/story-gutter';
import styles from './StoryMessage.module.css';

type Props = {
  avatar: ReactNode;
  name: string;
  time: string;
  // The user's own words sit in a box; replies run as the story.
  mine: boolean;
  // A quiet tag beside the name, always shown, such as 번역 on a reply shown as its translation; action is what a tap
  // on it does.
  mark?: { label: string; action: string; onClick: () => void };
  children: ReactNode;
  // Under the body: a cut marker, the version switcher.
  after?: ReactNode;
  // Shown on hover, or on phones after a tap on the message (pinned).
  tools?: ReactNode;
  pinned: boolean;
  onTap: () => void;
  // Marked for a moment from this timestamp, again with each look; 0 for none. The collection
  // brings the first marked row into view, even when it has not been mounted.
  found?: number;
};

export function StoryMessage({ avatar, name, time, mine, mark, children, after, tools, pinned, onTap, found = 0 }: Props) {
  const hover = useHover();
  const foundDelay = useMemo(() => `-${Math.max(0, Date.now() - found)}ms`, [found]);
  const memory = useContext(RowMemoryContext);
  const revisited = useRef(memory?.visited ?? false);
  const gutter = useContext(StoryGutterContext);
  // Phones have no hover, so a tap on the message itself shows its tools; not one the story took, such as on a picture.
  const tap = (event: MouseEvent) => {
    if (hover || event.defaultPrevented || (event.target as HTMLElement).closest('button, a, textarea')) return;
    onTap();
  };
  return (
    <article className={`${styles.message} ${pinned ? styles.pinned : ''} ${revisited.current ? styles.revisited : ''} ${gutter ? styles.gutter : ''}`} onClick={tap}>
      {found !== 0 && <span key={found} className={styles.found} style={{ animationDelay: foundDelay }} aria-hidden />}
      {avatar}
      <div className={styles.main}>
        <div className={styles.head}>
          <span className={mine ? styles.me : styles.name}>{name}</span>
          {mark && (
            <button type="button" className={styles.mark} aria-label={`${mark.label} · ${mark.action}`} title={mark.action} onClick={mark.onClick}>
              {mark.label}
            </button>
          )}
          <span className={styles.time}>{time}</span>
        </div>
        {mine ? <div className={styles.bubble}>{children}</div> : children}
        {after}
      </div>
      {tools && (
        <div className={styles.rail}>
          <div className={styles.tools}>{tools}</div>
        </div>
      )}
    </article>
  );
}

// The reply is on its way and no text has come yet.
export function Waiting() {
  return (
    <span className={styles.waiting} aria-label="답장을 기다리는 중">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
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
  // With the keys that press them.
  prevTitle: string;
  nextTitle: string;
  // Each version in a line, which the count's menu lists so any of them is one press away.
  versions: string[];
  selected: number;
  pickDisabled: boolean;
  onPick: (index: number) => void;
};

// ← n / m → between a message's versions.
export function Switcher({ label, onPrev, onNext, prevDisabled, nextDisabled, nextLabel, prevTitle, nextTitle, versions, selected, pickDisabled, onPick }: SwitcherProps) {
  return (
    <div className={styles.switcher}>
      <IconButton icon={ChevronLeft} label="이전" title={prevTitle} size="xs" disabled={prevDisabled} onClick={onPrev} />
      <Menu
        label="바로 고르기"
        place="above-start"
        trigger={(opener) => (
          <button type="button" className={styles.count} title="바로 고르기" disabled={pickDisabled} ref={opener.ref} aria-haspopup={opener.popup} aria-expanded={opener.expanded} onClick={opener.onClick}>
            {label}
          </button>
        )}
      >
        {versions.map((line, index) => (
          <MenuItem key={index} label={`${index + 1}`} sub={line} checked={index === selected} onClick={() => onPick(index)} />
        ))}
      </Menu>
      <IconButton icon={ChevronRight} label={nextLabel} title={nextTitle} size="xs" disabled={nextDisabled} onClick={onNext} />
    </div>
  );
}

// translation: the state of a message's translation, such as one being made or one that failed.
type MarkerProps = { reason: 'length' | 'stopped' | 'translation'; label: string; action?: { label: string; disabled: boolean; onClick: () => void } };
const MARKS = { length: Scissors, stopped: Square, translation: Languages };

// A reply that did not end cleanly says so, quietly, under its text.
export function Marker({ reason, label, action }: MarkerProps) {
  return (
    <div className={reason === 'stopped' ? `${styles.marker} ${styles.stopped}` : styles.marker}>
      <Icon icon={MARKS[reason]} size="xs" />
      <span>{action ? `${label} ·` : label}</span>
      {action && (
        <Button variant="link" size="xs" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </Button>
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
