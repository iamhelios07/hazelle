import { paragraphs } from './prose';
import styles from './Prose.module.css';

// Story text: narration, dialogue and actions in their own tones. cursor marks a reply still streaming.
export function Prose({ text, cursor = false }: { text: string; cursor?: boolean }) {
  const paras = paragraphs(text);
  if (cursor && paras.length === 0) paras.push([]);
  return (
    <div className={styles.prose}>
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
