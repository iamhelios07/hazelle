import { X } from 'lucide-react';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { IconButton } from '../controls/IconButton';
import { Hint, type Help } from '../overlays/Hint';
import styles from './SceneBoard.module.css';

// x and y: 0–1 from the picture's top left.
type Placed = { name: string; x: number; y: number };

type Props = {
  label: string;
  help?: Help;
  width: number;
  height: number;
  figures: readonly Placed[];
  onMove: (index: number, x: number, y: number) => void;
  onRemove: (index: number) => void;
};

const STEP = 0.05;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
const inside = (value: number) => Math.min(1, Math.max(0, value));

// Pointer events, not HTML drag, which touch screens lack. A drag shows here and reaches onMove once, on drop.
export function SceneBoard({ label, help, width, height, figures, onMove, onRemove }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const grip = useRef({ x: 0, y: 0 });
  const [held, setHeld] = useState<{ index: number; x: number; y: number; moved: boolean } | null>(null);
  const pointed = (event: PointerEvent) => {
    const box = board.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const grab = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = figures[index]!;
    const at = pointed(event);
    grip.current = { x: at.x - x, y: at.y - y };
    setHeld({ index, x, y, moved: false });
  };
  const drag = (index: number, event: PointerEvent) => {
    if (held?.index !== index) return;
    const at = pointed(event);
    setHeld({ index, x: inside(at.x - grip.current.x), y: inside(at.y - grip.current.y), moved: true });
  };
  const drop = (index: number) => {
    if (held?.index === index && held.moved) onMove(index, held.x, held.y);
    setHeld(null);
  };
  const step = (index: number, event: KeyboardEvent) => {
    const by = ARROWS[event.key];
    if (!by) return;
    event.preventDefault();
    const { x, y } = figures[index]!;
    onMove(index, inside(x + by[0]), inside(y + by[1]));
  };
  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {help && <Hint label={label}>{help}</Hint>}
      </div>
      <div ref={board} className={styles.board} role="group" aria-label={label} style={{ '--ratio': width / height } as CSSProperties}>
        {figures.map((figure, index) => {
          const shown = held?.index === index ? held : figure;
          return (
            <div key={index} className={shown === held ? `${styles.chip} ${styles.held}` : styles.chip} style={{ '--x': shown.x, '--y': shown.y } as CSSProperties}>
              <button
                type="button"
                className={styles.move}
                aria-label={`${figure.name} 위치`}
                title={figure.name}
                onPointerDown={(event) => grab(index, event)}
                onPointerMove={(event) => drag(index, event)}
                onPointerUp={() => drop(index)}
                onPointerCancel={() => setHeld(null)}
                onKeyDown={(event) => step(index, event)}
              >
                <span className={styles.name}>{figure.name}</span>
              </button>
              <IconButton icon={X} size="xs" label={`${figure.name} 빼기`} onClick={() => onRemove(index)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
