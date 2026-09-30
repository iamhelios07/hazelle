import { useEffect, useRef, type ReactNode } from 'react';
import styles from './SidePeek.module.css';

type Props = {
  label: string;
  // Held open by a key or a tap; pointing at the tab shows it only while the pointer stays.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
};

// A tab at the story's right edge whose drawer slides over the story while the tab or the drawer is pointed at,
// such as 상태. ChatFrame places it.
export function SidePeek({ label, open, onOpenChange, actions, children }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => root.current!.contains(event.target as Node) || onOpenChange(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onOpenChange(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={root} className={open ? `${styles.peek} ${styles.open}` : styles.peek}>
      <button type="button" className={styles.tab} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        {label}
      </button>
      <aside className={styles.drawer} aria-label={label}>
        <div className={styles.head}>
          <h2 className={styles.title}>{label}</h2>
          {actions}
        </div>
        {children}
      </aside>
    </div>
  );
}
