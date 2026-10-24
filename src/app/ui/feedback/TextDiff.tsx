import { useState } from 'react';
import styles from './TextDiff.module.css';

export type DiffRun = { kind: 'same' | 'before' | 'after'; text: string };

// Characters a shared stretch keeps beside each change, cut sooner at a line's end so a change reads on its own line.
const KEEP = 40;

// Code points, as the runs were split, so a fold never halves a character. head: the stretch follows a change and keeps
// its start; tail: one precedes and it keeps its end.
function folded(text: string, head: boolean, tail: boolean) {
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  if (head) {
    const line = chars.indexOf('\n');
    start = line !== -1 && line < KEEP ? line : Math.min(KEEP, chars.length);
  }
  if (tail) {
    const line = chars.lastIndexOf('\n');
    end = line !== -1 && chars.length - line - 1 < KEEP ? line + 1 : Math.max(chars.length - KEEP, start);
  }
  if (end - start < KEEP) return null;
  return { head: chars.slice(0, start).join(''), hidden: end - start, tail: chars.slice(end).join('') };
}

// inline: a few words in a sentence, such as a value before and after, without the box or the folds.
export function TextDiff({ runs, label, inline = false }: { runs: DiffRun[]; label: string; inline?: boolean }) {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const marks = runs.map((run, index) => {
    if (run.kind === 'before') return <del key={index} className={styles.before}>{run.text}</del>;
    if (run.kind === 'after') return <ins key={index} className={styles.after}>{run.text}</ins>;
    const fold = !inline && !opened.has(index) && folded(run.text, index > 0, index < runs.length - 1);
    if (!fold) return <span key={index}>{run.text}</span>;
    return (
      <span key={index}>
        {fold.head}
        <button type="button" className={styles.fold} onClick={() => setOpened(new Set(opened).add(index))}>{`같은 내용 ${fold.hidden.toLocaleString()}자`}</button>
        {fold.tail}
      </span>
    );
  });
  if (inline) return <span className={styles.inline} aria-label={label}>{marks}</span>;
  return <pre className={styles.diff} aria-label={label}>{marks}</pre>;
}
