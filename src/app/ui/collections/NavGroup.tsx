import { useId, type ReactNode } from 'react';
import styles from './NavGroup.module.css';

// Places in the app under a small caption, such as 설정's 대화, 모델 and 일반.
export function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.group} role="group" aria-labelledby={id}>
      <span id={id} className={styles.caption}>
        {label}
      </span>
      {children}
    </div>
  );
}
