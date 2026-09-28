import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

type Props = { title: string; subtitle?: string; backLabel?: string; onBack: () => void; actions?: ReactNode };

// The top row of every screen below home: back, the screen's name, and its own actions. Beside its
// list (ListDetail) a screen has nothing to go back to.
export function NavBar({ title, subtitle, backLabel = '뒤로', onBack, actions }: Props) {
  const pane = usePane();
  return (
    <div className={styles.bar}>
      {pane !== 'detail' && (
        <span className={styles.back}>
          <IconButton icon={ChevronLeft} label={backLabel} onClick={onBack} />
        </span>
      )}
      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
