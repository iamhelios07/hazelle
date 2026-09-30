import { useId, type ReactNode } from 'react';
import { Hint } from '../overlays/Hint';
import styles from './SettingGroup.module.css';

// Settings in one rounded box, a line between each.
export function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {children}
    </div>
  );
}

type RowProps = {
  label: string;
  // The label as a sentence with a control inside it, such as the language in 답장을 한국어로 번역해서 보기, shown in the
  // label's place; label stays the row's name.
  sentence?: ReactNode;
  // panel: one of a side panel's list, such as a chat's toggles, with no box and its control beside it on phones too.
  place?: 'group' | 'panel';
  // Differs from its default, marked by a dot before the label; sub may say what the default is.
  changed?: boolean;
  // What the reader who does not know it needs, behind an ⓘ. A label it only restates is left out.
  help?: string;
  // A line always shown under the label, for facts about this row, such as a toggle's key or its default.
  sub?: ReactNode;
  // What sets it: a field, a menu, a button, or a fact in words. Beside the words where there is room, under them on phones.
  control: ReactNode;
  // Under the words at every width, for a control as wide as the row, such as a row of chips. Beside them, its
  // grid column takes the chips' one-line width and squeezes the words to a letter a line.
  wide?: boolean;
  error?: string;
  // A quiet line under it, such as what some models are sent of the value instead.
  note?: string;
};

export function SettingRow({ label, sentence, place = 'group', changed = false, help, sub, control, wide = false, error, note }: RowProps) {
  const id = useId();
  const className = [styles.row, place === 'panel' && styles.panel, wide && styles.wide].filter(Boolean).join(' ');
  return (
    <div className={className} role="group" aria-labelledby={sentence ? undefined : id} aria-label={sentence ? label : undefined}>
      <div className={styles.words}>
        <span className={styles.name}>
          <span id={id} className={sentence ? `${styles.label} ${styles.sentence}` : styles.label}>
            {changed && <span className={styles.changed} aria-hidden />}
            {sentence ?? label}
          </span>
          {help && <Hint label={label}>{help}</Hint>}
        </span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </div>
      <div className={styles.control}>{control}</div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
