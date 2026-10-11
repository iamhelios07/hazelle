import styles from './Brand.module.css';
import { MARK } from './mark';

// mark: the glyph alone, where the name would crowd it, such as the rail's home button.
export function Brand({ variant = 'full' }: { variant?: 'full' | 'mark' }) {
  return (
    <span className={styles.brand}>
      <svg className={styles.mark} viewBox={MARK.viewBox} aria-hidden="true">
        <path fill="currentColor" fillRule="evenodd" d={MARK.path} />
      </svg>
      {variant === 'full' && <span className={styles.name}>헤이젤</span>}
    </span>
  );
}
