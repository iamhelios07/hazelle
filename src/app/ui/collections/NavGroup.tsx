import { useId, type ReactNode } from 'react';
import styles from './NavGroup.module.css';

// Places in the app under a small caption, such as 설정's 모델 and 대화. Without a label it only sets the places apart.
export function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  const id = useId();
  if (!label) return <div className={styles.group}>{children}</div>;
  return (
    <div className={styles.group} role="group" aria-labelledby={id}>
      <span id={id} className={styles.caption}>
        {label}
      </span>
      {children}
    </div>
  );
}
