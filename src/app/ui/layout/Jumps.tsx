import { createContext, useCallback, useState, type ReactNode } from 'react';
import styles from './Jumps.module.css';

type Mark = (title: string, section: HTMLElement | null) => void;

// Each Section inside Jumps marks itself here; a Section hands null to what it holds, so only the outer ones get a chip.
export const JumpContext = createContext<Mark | null>(null);

const inPageOrder = (a: HTMLElement, b: HTMLElement) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

export function Jumps({ label, children }: { label: string; children: ReactNode }) {
  const [sections, setSections] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const mark = useCallback<Mark>((title, section) => {
    setSections((current) => {
      const next = new Map(current);
      if (section) next.set(title, section);
      else next.delete(title);
      return next;
    });
  }, []);
  const chips = [...sections].sort(([, a], [, b]) => inPageOrder(a, b));
  return (
    <>
      <nav className={styles.jumps} aria-label={label}>
        {chips.map(([title, section]) => (
          <button key={title} type="button" className={styles.jump} onClick={() => section.scrollIntoView({ block: 'start' })}>
            {title}
          </button>
        ))}
      </nav>
      <JumpContext value={mark}>{children}</JumpContext>
    </>
  );
}
