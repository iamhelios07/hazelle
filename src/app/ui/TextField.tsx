import { useId } from 'react';
import styles from './TextField.module.css';

// Each kind carries the input attributes that belong together, so screens cannot mix them up.
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
  error?: string;
  // Makes the field a text area of this many lines.
  lines?: number;
};

export function TextField({ label, kind = 'text', value, onChange, placeholder, hint, error, lines }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {lines ? (
        <textarea
          id={id}
          className={`${styles.input} ${styles.area}`}
          rows={lines}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
        />
      ) : (
        <input
          id={id}
          className={kind === 'key' ? `${styles.input} ${styles.mono}` : styles.input}
          {...KINDS[kind]}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
        />
      )}
      {note && (
        <p id={noteId} className={error ? styles.error : styles.hint}>
          {note}
        </p>
      )}
    </div>
  );
}
