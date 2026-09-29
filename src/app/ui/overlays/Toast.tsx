import { Button } from '../controls/Button';
import styles from './Toast.module.css';

type Props = { message: string; action?: { label: string; onClick: () => void }; floating: boolean };

// floating: at the top of the window; otherwise in a place the page keeps for it.
export function Toast({ message, action, floating }: Props) {
  return (
    <div className={floating ? `${styles.toast} ${styles.floating}` : styles.toast} role="status">
      <span className={styles.message}>{message}</span>
      {action && (
        <Button variant="link" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
