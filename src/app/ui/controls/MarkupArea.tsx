import { useId, useMemo, type Ref } from 'react';
import { markup, type Piece } from './markup';
import styles from './MarkupArea.module.css';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // page: the text is the page, as a text block's is. field: a boxed field, such as a 감싸는 글.
  variant?: 'page' | 'field';
  ref?: Ref<HTMLTextAreaElement>;
};

const LINE = { body: null, heading: styles.heading, rule: styles.rule } as const;
const MARK = { cbs: styles.cbs, slot: styles.slot, angle: styles.angle } as const;
const pieceClass = (piece: Piece) => [LINE[piece.line], piece.mark && MARK[piece.mark]].filter(Boolean).join(' ') || undefined;

// Prompt text with its CBS tags, <tags>, headings and rules colored. The colors are drawn on a layer behind a
// transparent textarea, so the layer must set the text exactly as the textarea does: it never changes weight, size,
// spacing or font (a heading is brighter, not bolder), or the caret drifts from the letters. The layer is in the flow
// and the textarea covers it, so the box grows with the text.
export function MarkupArea({ label, value, onChange, placeholder, variant = 'page', ref }: Props) {
  const id = useId();
  // A last empty line has no height in the layer until something is on it.
  const pieces = useMemo(() => markup(value === '' || value.endsWith('\n') ? `${value}\u200b` : value), [value]);
  return (
    <div className={variant === 'field' ? styles.field : undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.frame}>
        <div className={styles.layer} aria-hidden>
          {pieces.map((piece, index) => (
            <span key={index} className={pieceClass(piece)}>
              {piece.text}
            </span>
          ))}
        </div>
        <textarea id={id} ref={ref} className={styles.input} value={value} placeholder={placeholder} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}
