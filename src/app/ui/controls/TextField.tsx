import { useId, type ChangeEvent, type ReactNode } from 'react';
import type { Chord } from '../foundation/keys';
import { Hint } from '../overlays/Hint';
import styles from './TextField.module.css';
import { useBigEdit } from './useBigEdit';

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
  // A text area's keys for its big editor, which a button by its label opens too.
  expand?: readonly Chord[];
};

export function TextField({ label, showLabel = true, kind = 'text', value, onChange, placeholder, hint, help, error, lines, readOnly, action, expand }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const { type, ...typed } = KINDS[kind];
  const look = kind === 'key' ? `${styles.input} ${styles.mono}` : styles.input;
  const shared = {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    readOnly,
    'aria-invalid': error ? true : undefined,
  };
  const big = useBigEdit(expand, label, () => <textarea className={`${look} ${styles.big}`} aria-label={label} data-autofocus {...typed} {...shared} />);
  const own = { id, 'aria-label': showLabel ? undefined : label, 'aria-describedby': note ? noteId : undefined, ...shared };
  return (
    <>
      <div className={styles.field} {...big.wrap}>
        {showLabel && <div className={styles.head}>
          <span className={styles.name}>
            <label className={styles.label} htmlFor={id}>
              {label}
            </label>
            {help && <Hint label={label}>{help}</Hint>}
          </span>
          {action}
          {big.button}
        </div>}
        {lines ? (
          <textarea className={`${look} ${styles.area}`} rows={lines} {...typed} {...own} />
        ) : (
          <input className={look} type={type} {...typed} {...own} />
        )}
        {note && (
          <p id={noteId} className={error ? styles.error : styles.hint}>
            {note}
          </p>
        )}
      </div>
      {big.dialog}
    </>
  );
}
