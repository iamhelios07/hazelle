import { X } from 'lucide-react';
import { useState } from 'react';
import { Icon } from '../foundation/Icon';
import { isComposing } from '../foundation/keys';
import styles from './PhraseField.module.css';

type Props = { label: string; phrases: string[]; onChange: (phrases: string[]) => void };

// Phrases as removable chips, and a field that adds the one typed on Enter. A phrase is kept exactly as
// typed: a stop phrase's spaces are part of it.
export function PhraseField({ label, phrases, onChange }: Props) {
  const [draft, setDraft] = useState('');
  return (
    <div className={styles.field} role="group" aria-label={label}>
      {phrases.map((phrase) => (
        <span key={phrase} className={styles.chip}>
          <span className={styles.text}>{phrase}</span>
          <button type="button" className={styles.remove} aria-label={`‘${phrase}’ 빼기`} onClick={() => onChange(phrases.filter((kept) => kept !== phrase))}>
            <Icon icon={X} size="xs" />
          </button>
        </span>
      ))}
      <input
        className={styles.input}
        type="text"
        autoComplete="off"
        aria-label={`${label} 더하기`}
        placeholder="적고 Enter"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isComposing(event.nativeEvent)) return;
          event.preventDefault();
          if (!draft.trim() || phrases.includes(draft)) return;
          onChange([...phrases, draft]);
          setDraft('');
        }}
      />
    </div>
  );
}
