import { paragraphs } from './prose';
import styles from './Prose.module.css';

// Story text: narration, dialogue and actions in their own tones. cursor marks a reply still streaming. faded: text
// that another will take the place of, such as a reply's original while its translation is awaited.
export function Prose({ text, cursor = false, tone = 'plain' }: { text: string; cursor?: boolean; tone?: 'plain' | 'faded' }) {
  const paras = paragraphs(text);
  if (cursor && paras.length === 0) paras.push([]);
  return (
    <div className={tone === 'faded' ? `${styles.prose} ${styles.faded}` : styles.prose}>
      {paras.map((segments, index) => (
        <p key={index} className={styles.paragraph}>
          {segments.map((segment, at) => (
            <span key={at} className={styles[segment.kind]}>
              {segment.text}
            </span>
          ))}
          {cursor && index === paras.length - 1 && <span className={styles.cursor} aria-hidden />}
        </p>
      ))}
    </div>
  );
}
