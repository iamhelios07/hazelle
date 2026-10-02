import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Avatar } from '../foundation/Avatar';
import { isComposing } from '../foundation/keys';
import { Hint } from '../overlays/Hint';
import styles from './AskCard.module.css';

export type AskAnswer = { kind: 'line' } | { kind: 'choices'; choices: { label: string; value: string | null; primary?: boolean }[] };

type Props = {
  // Who asks.
  from: { name: string; face: string | null };
  // What is asked, its line breaks kept, and behind an ⓘ what a reader who does not know it needs.
  text?: string;
  help?: string;
  // A line typed, or one of a few choices. A choice's value is what picking it answers.
  answer: AskAnswer;
  // null: put away unanswered, which the × does.
  onAnswer: (value: string | null) => void;
};

// A question beside what the user is doing, such as a bot's by the composer: it waits there and takes no focus, but
// for the line it asks to be typed.
export function AskCard({ from, text, help, answer, onAnswer }: Props) {
  return (
    <section className={styles.card} aria-label={`${from.name}의 질문`}>
      <div className={styles.head}>
        <Avatar face={from.name} image={from.face} size="sm" />
        <span className={styles.name}>{from.name}</span>
        <IconButton icon={X} size="xs" label="닫기" onClick={() => onAnswer(null)} />
      </div>
      {text && (
        <div className={styles.asked}>
          <p className={styles.text}>{text}</p>
          {help && <Hint label={text}>{help}</Hint>}
        </div>
      )}
      {answer.kind === 'line' ? (
        <Line onSubmit={onAnswer} />
      ) : (
        <div className={`${styles.answer} ${styles.choices}`}>
          {answer.choices.map(({ label, value, primary }, index) => (
            <Button key={index} variant={primary ? 'primary' : 'secondary'} size="sm" onClick={() => onAnswer(value)}>
              {label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function Line({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className={styles.answer}>
      <input
        className={styles.input}
        type="text"
        autoComplete="off"
        autoFocus
        aria-label="답"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isComposing(event.nativeEvent)) return;
          event.preventDefault();
          onSubmit(draft);
        }}
      />
      <Button variant="primary" size="sm" onClick={() => onSubmit(draft)}>
        답하기
      </Button>
    </div>
  );
}
