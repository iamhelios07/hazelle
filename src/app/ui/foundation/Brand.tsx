import styles from './Brand.module.css';
import { MARK } from './mark';

export function Brand() {
  return (
    <span className={styles.brand}>
      <svg className={styles.mark} viewBox={MARK.viewBox} aria-hidden="true">
        <path fill="currentColor" fillRule="evenodd" d={MARK.path} />
      </svg>
      <span className={styles.name}>헤이젤</span>
    </span>
  );
}
