import { useId, useMemo, type Ref } from 'react';
import type { Chord } from '../foundation/keys';
import { markup, type Piece } from './markup';
import styles from './MarkupArea.module.css';
import { useBigEdit } from './useBigEdit';
import { tagWeights } from './weights';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variant?: 'page' | 'field';
  // prompt: CBS, slots and <tags>; tags: image tags colored by their weight.
  kind?: 'prompt' | 'tags';
  // The keys for its big editor, which a button beside the text opens too.
  expand?: readonly Chord[];
  ref?: Ref<HTMLTextAreaElement>;
};

const LINE = { body: null, heading: styles.heading, rule: styles.rule } as const;
const MARK = { cbs: styles.cbs, slot: styles.slot, angle: styles.angle } as const;
const pieceClass = (piece: Piece) => [LINE[piece.line], piece.mark && MARK[piece.mark]].filter(Boolean).join(' ') || undefined;

// Steps of about two braces up, and one or two brackets down.
function weightClass(weight: number | null): string | undefined {
  if (weight === null) return styles.weightSyntax;
  if (weight < 0) return styles.weightNegative;
  if (weight < 0.9) return styles.weightDown2;
  if (weight < 1) return styles.weightDown1;
  if (weight === 1) return undefined;
  if (weight < 1.1) return styles.weightUp1;
  return weight < 1.3 ? styles.weightUp2 : styles.weightUp3;
}

const spansOf = (kind: Props['kind'], text: string) =>
  kind === 'tags' ? tagWeights(text).map(({ text: piece, weight }) => ({ text: piece, className: weightClass(weight) })) : markup(text).map((piece) => ({ text: piece.text, className: pieceClass(piece) }));

// Not a state write: that would skip the browser's undo stack, so Ctrl+Z could not take the insert back.
// insertText lands on it and fires input, which reaches onChange.
export function typeInto(area: HTMLTextAreaElement, [start, end]: [number, number], text: string) {
  area.focus();
  area.setSelectionRange(start, end);
  document.execCommand('insertText', false, text);
}

type FrameProps = Pick<Props, 'value' | 'onChange' | 'placeholder' | 'kind' | 'ref'> & { id?: string; label?: string; big?: boolean };

// The colors are drawn on a layer behind a transparent textarea, so the layer must set the text exactly as the
// textarea does: it never changes weight, size, spacing or font (a heading is brighter, not bolder), or the caret
// drifts from the letters. The layer is in the flow and the textarea covers it, so the box grows with the text.
function Frame({ value, onChange, placeholder, kind, ref, id, label, big }: FrameProps) {
  // A last empty line has no height in the layer until something is on it.
  const pieces = useMemo(() => spansOf(kind, value === '' || value.endsWith('\n') ? `${value}\u200b` : value), [kind, value]);
  return (
    <div className={big ? `${styles.frame} ${styles.big}` : styles.frame}>
      <div className={styles.layer} aria-hidden>
        {pieces.map((piece, index) => (
          <span key={index} className={piece.className}>
            {piece.text}
          </span>
        ))}
      </div>
      <textarea id={id} ref={ref} aria-label={label} data-autofocus={big || undefined} className={styles.input} value={value} placeholder={placeholder} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function MarkupArea({ label, value, onChange, placeholder, variant = 'page', kind = 'prompt', expand, ref }: Props) {
  const id = useId();
  const shared = { value, onChange, placeholder, kind };
  const big = useBigEdit(expand, label, (copy) => <Frame {...shared} ref={copy.area} label={label} big />);
  const frame = <Frame {...shared} id={id} ref={ref} />;
  return (
    <>
      <div className={variant === 'field' ? styles.field : undefined} {...big.wrap}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {big.button ? (
          <div className={styles.beside}>
            {frame}
            {big.button}
          </div>
        ) : (
          frame
        )}
      </div>
      {big.dialog}
    </>
  );
}
