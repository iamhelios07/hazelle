import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Row } from '../layout/Row';
import styles from './NoticeBar.module.css';

type Props = { icon: LucideIcon; title: string; note?: string; actions: ReactNode };

// NoticeCard's standing in one line, for where the card is put away or no longer stands; it has no ×.
export function NoticeBar({ icon, title, note, actions }: Props) {
  return (
    <section className={styles.bar} aria-label={title}>
      <span className={styles.lead}>
        <span className={styles.icon}>
          <Icon icon={icon} />
        </span>
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          {note && <span className={styles.note}>{note}</span>}
        </span>
      </span>
      <Row kind="actions">{actions}</Row>
    </section>
  );
}
