import styles from './Toast.module.css';

type Props = { message: string; action?: { label: string; onClick: () => void } };

// design F3: deletion takes effect at once and a toast offers 되돌리기 instead of a confirm dialog.
export function Toast({ message, action }: Props) {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.message}>{message}</span>
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
