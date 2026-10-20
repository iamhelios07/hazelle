import { useState, type Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  // What a blank means where it is a value, as NameDialog's blank: it lets the blank through, and the placeholder names
  // what stands in for it.
  blank?: string;
  onChange: (value: string) => void;
  // The head it renames: a page's title, or a one-line head with a subtitle under it; else a title inside a pane.
  place?: 'page' | 'line';
  ref?: Ref<HTMLInputElement>;
};

// Without blank, a blank name keeps the last one (a ruling): onChange never hears a blank, and leaving the field blank
// shows value again. While focused the field shows what was typed, so a caller that trims or snaps what it stores
// cannot move the text under the caret.
export function TitleField({ label, value, placeholder, blank, onChange, place, ref }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      ref={ref}
      className={place ? `${styles.field} ${styles[place]}` : styles.field}
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      title={blank}
      autoComplete="off"
      spellCheck={false}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        if (blank !== undefined || event.target.value.trim()) onChange(event.target.value);
      }}
    />
  );
}
