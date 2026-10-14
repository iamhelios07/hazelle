import type { ReactNode } from 'react';
import styles from './Panel.module.css';
import { Section } from './Section';

type Props = {
  title?: string;
  level?: 2 | 3;
  help?: string;
  // By the title: a button (sm) or a control that acts on the whole card, such as its Switch.
  action?: ReactNode;
  seek?: boolean;
  children: ReactNode;
};

// A Section whose body is a card of its own, where its rows would leave the width empty: a setting's group, a status.
// The heading stands over the card, never inside it, so a page reads as titled sections and not as a wall of boxes.
export function Panel({ title, level = 2, help, action, seek = false, children }: Props) {
  const card = <div className={styles.panel}>{children}</div>;
  return title ? (
    <Section title={title} level={level} help={help} action={action} seek={seek} boxed>
      {card}
    </Section>
  ) : (
    card
  );
}
