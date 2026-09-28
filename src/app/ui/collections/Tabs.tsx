import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './Tabs.module.css';

// A row of filters over one list, such as the folders of 캐릭터 둘러보기. It wraps on narrow screens.
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.tabs} role="group" aria-label={label}>
      {children}
    </div>
  );
}

type TabProps = { label: string; count?: number; current: boolean; onClick: () => void };

export function Tab({ label, count, current, onClick }: TabProps) {
  return <Item density="chip" scheme="tab" title={label} meta={count} pressed={current} onClick={onClick} />;
}
