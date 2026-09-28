import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { TitleField } from '../controls/TitleField';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

type Props = {
  title: string;
  // Makes the title a field that renames what the screen shows, with placeholder standing in while it is empty.
  rename?: { label: string; placeholder: string; onChange: (title: string) => void };
  subtitle?: ReactNode;
  backLabel: string;
  onBack: () => void;
  // Whether an edit is saved, before the actions.
  status?: string;
  actions?: ReactNode;
};

// The top row of every screen below home: back, the screen's name, and its own actions. Beside its
// list (ListDetail) a screen has nothing to go back to.
export function NavBar({ title, rename, subtitle, backLabel, onBack, status, actions }: Props) {
  const pane = usePane();
  return (
    <div className={styles.bar}>
      {pane !== 'detail' && (
        <span className={styles.back}>
          <IconButton icon={ChevronLeft} label={backLabel} onClick={onBack} />
        </span>
      )}
      <div className={styles.titles}>
        {rename ? (
          <h1 className={styles.title}>
            <TitleField size="md" label={rename.label} value={title} placeholder={rename.placeholder} onChange={rename.onChange} />
          </h1>
        ) : (
          <h1 className={styles.title}>{title}</h1>
        )}
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {status !== undefined && (
        <span className={styles.status} role="status">
          {status}
        </span>
      )}
      {actions}
    </div>
  );
}
