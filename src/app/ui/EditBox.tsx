import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './EditBox.module.css';

type Props = { value: string; onChange: (value: string) => void; onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; hint: string; actions: ReactNode };

// A message being edited in place, in the story's own type. It takes the focus when it opens.
export function EditBox({ value, onChange, onKeyDown, hint, actions }: Props) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = area.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [value]);
  return (
    <div className={styles.box}>
      <label className={styles.label} htmlFor={id}>
        메시지 수정
      </label>
      <textarea id={id} ref={area} className={styles.input} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
      <div className={styles.bar}>
        <span className={styles.hint}>{hint}</span>
        {actions}
      </div>
    </div>
  );
}
