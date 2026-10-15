import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './EditBox.module.css';
import { useAutosize } from './useAutosize';

type Field = { label: string; value: string; onChange: (value: string) => void };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  actions?: ReactNode;
  second?: Field & { firstLabel: string };
};

export function EditBox({ value, onChange, onKeyDown, actions, second }: Props) {
  return (
    <div className={styles.box}>
      <Area label={second?.firstLabel ?? '메시지 수정'} shown={second !== undefined} value={value} onChange={onChange} onKeyDown={onKeyDown} focus />
      {second && <Area label={second.label} shown value={second.value} onChange={second.onChange} onKeyDown={onKeyDown} focus={false} />}
      {actions && <div className={styles.bar}>{actions}</div>}
    </div>
  );
}

function Area({ label, shown, value, onChange, onKeyDown, focus }: Field & { shown: boolean; onKeyDown: Props['onKeyDown']; focus: boolean }) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    const element = area.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [focus]);
  useAutosize(area, value);
  return (
    <>
      <label className={shown ? styles.fieldLabel : styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea id={id} ref={area} className={styles.input} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
    </>
  );
}
