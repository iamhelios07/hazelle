import { useId, type ChangeEvent, type ReactNode } from 'react';
import { Hint } from '../overlays/Hint';
import styles from './TextField.module.css';

const KINDS = {
  text: { type: 'text' },
  username: { type: 'text', autoComplete: 'username', autoCapitalize: 'none', spellCheck: false },
  code: { type: 'text', autoComplete: 'off', autoCapitalize: 'characters', spellCheck: false },
  // API keys, addresses and a script's code: shown as typed, in the mono face, never saved by the browser.
  key: { type: 'text', autoComplete: 'off', autoCapitalize: 'none', spellCheck: false },
  'new-password': { type: 'password', autoComplete: 'new-password' },
  'current-password': { type: 'password', autoComplete: 'current-password' },
} as const;

type Props = {
  label: string;
  showLabel?: boolean;
  kind?: keyof typeof KINDS;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  help?: string;
  error?: string;
  lines?: number;
  readOnly?: boolean;
  action?: ReactNode;
};

export function TextField({ label, showLabel = true, kind = 'text', value, onChange, placeholder, hint, help, error, lines, readOnly, action }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const { type, ...typed } = KINDS[kind];
  const look = kind === 'key' ? `${styles.input} ${styles.mono}` : styles.input;
  const shared = {
    id,
    'aria-label': showLabel ? undefined : label,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    readOnly,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': note ? noteId : undefined,
  };
  return (
    <div className={styles.field}>
      {showLabel && <div className={styles.head}>
        <span className={styles.name}>
          <label className={styles.label} htmlFor={id}>
            {label}
          </label>
          {help && <Hint label={label}>{help}</Hint>}
        </span>
        {action}
      </div>}
      {lines ? (
        <textarea className={`${look} ${styles.area}`} rows={lines} {...typed} {...shared} />
      ) : (
        <input className={look} type={type} {...typed} {...shared} />
      )}
      {note && (
        <p id={noteId} className={error ? styles.error : styles.hint}>
          {note}
        </p>
      )}
    </div>
  );
}
