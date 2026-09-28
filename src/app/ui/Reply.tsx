import styles from './Reply.module.css';

type Props = { reasoning: string; text: string; streaming: boolean };

// A model's answer as it streams. Reasoning is kept apart and quieter, and only when the model sent any.
export function Reply({ reasoning, text, streaming }: Props) {
  return (
    <div className={styles.reply} aria-live="polite" aria-busy={streaming}>
      {reasoning && (
        <details className={styles.reasoning}>
          <summary className={styles.summary}>생각한 과정</summary>
          <p className={styles.reasoningText}>{reasoning}</p>
        </details>
      )}
      <p className={styles.text}>
        {text}
        {streaming && <span className={styles.caret} aria-hidden />}
      </p>
    </div>
  );
}
