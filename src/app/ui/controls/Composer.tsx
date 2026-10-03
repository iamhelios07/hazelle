import { useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import styles from './Composer.module.css';
import { useAutosize } from './useAutosize';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  placeholder: string;
  hint: string;
  tools?: ReactNode;
  actions: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  compact: boolean;
};

export function Composer({ value, onChange, onKeyDown, onFocus, onBlur, placeholder, hint, tools, actions, inputRef, compact }: Props) {
  const id = useId();
  useAutosize(inputRef, value);
  return (
    <div className={`${styles.composer} ${compact ? styles.compact : ''}`}>
      <label className={styles.label} htmlFor={id}>
        메시지
      </label>
      <textarea
        id={id}
        ref={inputRef}
        className={styles.input}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <div className={styles.fold}>
        <div className={styles.tools}>
          <div className={styles.bar}>
            {tools}
            <span className={styles.hint}>{hint}</span>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
