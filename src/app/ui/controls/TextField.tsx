import { useId, type ChangeEvent, type ReactNode } from 'react';
import { Hint } from '../overlays/Hint';
import styles from './TextField.module.css';

const KINDS = {
  text: { type: 'text' },
  username: { type: 'text', autoComplete: 'username', autoCapitalize: 'none', spellCheck: false },
  code: { type: 'text', autoComplete: 'off', autoCapitalize: 'characters', spellCheck: false },
  // API keys and addresses: shown as typed, in the mono face, never saved by the browser.
  key: { type: 'text', autoComplete: 'off', autoCapitalize: 'none', spellCheck: false },
  'new-password': { type: 'password', autoComplete: 'new-password' },
  'current-password': { type: 'password', autoComplete: 'current-password' },
} as const;

type Props = {
  label: string;
  kind?: keyof typeof KINDS;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  help?: string;
  error?: string;
  lines?: number;
  action?: ReactNode;
};

export function TextField({ label, kind = 'text', value, onChange, placeholder, hint, help, error, lines, action }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const shared = {
    id,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': note ? noteId : undefined,
  };
  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <span className={styles.name}>
          <label className={styles.label} htmlFor={id}>
            {label}
          </label>
          {help && <Hint label={label}>{help}</Hint>}
        </span>
        {action}
      </div>
      {lines ? (
        <textarea className={`${styles.input} ${styles.area}`} rows={lines} {...shared} />
      ) : (
        <input className={kind === 'key' ? `${styles.input} ${styles.mono}` : styles.input} {...KINDS[kind]} {...shared} />
      )}
      {note && (
        <p id={noteId} className={error ? styles.error : styles.hint}>
          {note}
        </p>
      )}
    </div>
  );
}
