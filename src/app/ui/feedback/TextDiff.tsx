import { useState } from 'react';
import styles from './TextDiff.module.css';

export type DiffRun = { kind: 'same' | 'before' | 'after'; text: string };

// Characters a shared stretch keeps beside each change; one longer than twice this folds its middle.
const KEEP = 80;

// Code points, as the runs were split, so a fold never halves a character.
const folded = (text: string, head: boolean, tail: boolean) => {
  const chars = Array.from(text);
  const keep = (head ? KEEP : 0) + (tail ? KEEP : 0);
  if (chars.length <= keep + KEEP) return null;
  return { head: head ? chars.slice(0, KEEP).join('') : '', hidden: chars.length - keep, tail: tail ? chars.slice(-KEEP).join('') : '' };
};

export function TextDiff({ runs, label }: { runs: DiffRun[]; label: string }) {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  return (
    <pre className={styles.diff} aria-label={label}>
      {runs.map((run, index) => {
        if (run.kind === 'before') return <del key={index} className={styles.before}>{run.text}</del>;
        if (run.kind === 'after') return <ins key={index} className={styles.after}>{run.text}</ins>;
        const fold = !opened.has(index) && folded(run.text, index > 0, index < runs.length - 1);
        if (!fold) return <span key={index}>{run.text}</span>;
        return (
          <span key={index}>
            {fold.head}
            <button type="button" className={styles.fold} onClick={() => setOpened(new Set(opened).add(index))}>{`같은 내용 ${fold.hidden.toLocaleString()}자`}</button>
            {fold.tail}
          </span>
        );
      })}
    </pre>
  );
}
