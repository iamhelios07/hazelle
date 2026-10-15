import type { ReactNode } from 'react';
import type { Help } from '../overlays/Hint';
import styles from './Panel.module.css';
import { Section } from './Section';

type Props = {
  title?: string;
  level?: 2 | 3;
  help?: Help;
  // By the title: a button (sm) or a control that acts on the whole card, such as its Switch.
  action?: ReactNode;
  seek?: boolean;
  // It holds only the line saying it is empty: drawn under the heading with no card, so an empty section weighs less
  // than one holding something.
  empty?: boolean;
  children: ReactNode;
};

// A Section whose body is a card of its own, where its rows would leave the width empty: a setting's group, a status.
// The heading stands over the card, never inside it, so a page reads as titled sections and not as a wall of boxes.
export function Panel({ title, level = 2, help, action, seek = false, empty = false, children }: Props) {
  const card = empty ? children : <div className={styles.panel}>{children}</div>;
  return title ? (
    <Section title={title} level={level} help={help} action={action} seek={seek} boxed>
      {card}
    </Section>
  ) : (
    card
  );
}
