import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Sketch.module.css';

// A picture of a screen drawn in code, for a Tour: rows of text bars, tags and marks, never real content. Decorative
// (aria-hidden): the title and text beside it carry the meaning. badge: a count in the corner, as the rail shows one.
export function Sketch({ badge, children }: { badge?: number; children: ReactNode }) {
  return (
    <div className={styles.sketch} aria-hidden>
      {badge !== undefined && <span className={styles.badge}>{badge}</span>}
      {children}
    </div>
  );
}

// indent: a 답글 under its comment. accent: the row the page is about.
function SketchRow({ indent = false, accent = false, children }: { indent?: boolean; accent?: boolean; children: ReactNode }) {
  return <div className={[styles.row, indent && styles.indent, accent && styles.accent].filter(Boolean).join(' ')}>{children}</div>;
}

// A bar standing for a line of text.
function SketchLine({ width }: { width: 'short' | 'medium' | 'long' }) {
  return <span className={`${styles.line} ${styles[width]}`} />;
}

// An icon at the row's end, with a count when it has one. lit: in the accent colour, as a pressed 추천.
function SketchMark({ icon, count, lit = false }: { icon: LucideIcon; count?: number; lit?: boolean }) {
  return (
    <span className={lit ? `${styles.mark} ${styles.lit}` : styles.mark}>
      <Icon icon={icon} size="sm" />
      {count}
    </span>
  );
}

Sketch.Row = SketchRow;
Sketch.Line = SketchLine;
Sketch.Mark = SketchMark;
