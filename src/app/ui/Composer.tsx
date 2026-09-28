import { ArrowUp, Square } from 'lucide-react';
import { useId, useLayoutEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import styles from './Composer.module.css';
import { Icon } from './Icon';

// Grows with its text up to a cap, then scrolls.
function fit(area: HTMLTextAreaElement | null) {
  if (!area) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  placeholder: string;
  hint: string;
  actions: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ value, onChange, onKeyDown, onFocus, onBlur, placeholder, hint, actions, inputRef }: Props) {
  const id = useId();
  useLayoutEffect(() => fit(inputRef.current), [value, inputRef]);
  return (
    <div className={styles.composer}>
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
      <div className={styles.bar}>
        <span className={styles.hint}>{hint}</span>
        {actions}
      </div>
    </div>
  );
}

type SendProps = { streaming: boolean; disabled: boolean; title: string; onClick: () => void };

// Send, or 멈추기 while this chat's reply is being written.
export function SendButton({ streaming, disabled, title, onClick }: SendProps) {
  return (
    <button
      type="button"
      className={streaming ? `${styles.send} ${styles.stop}` : styles.send}
      aria-label={streaming ? '답장 멈추기' : '보내기'}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={streaming ? Square : ArrowUp} size="xs" />
    </button>
  );
}

// A floating button over the story, such as 새 답장 when the view is scrolled up.
export function Pill({ label, live, onClick }: { label: string; live: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.pill} onClick={onClick}>
      {live && <span className={styles.live} />}
      {label}
    </button>
  );
}
