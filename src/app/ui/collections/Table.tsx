import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import a11y from '../foundation/a11y.module.css';
import { Icon } from '../foundation/Icon';
import { cardDrag, useCardDrop } from './cardDrag';
import styles from './Table.module.css';

// name: the row's own column, wider than the rest; figure: a count or a size, set right; button: a row's ⋯.
// keep: still shown when the table is narrow, where every other column but the first gives way to the row's summary.
export type TableColumn = { label: string; size: 'name' | 'fill' | 'figure' | 'button'; keep?: boolean };

// A null cell is something the row does not have, drawn as a dash. summary: the row's other columns as one line, shown
// under its first cell when the table is narrow. icon: before the first cell, such as a folder's mark. selected: one of
// a pick of several, absent while not picking. drag: the row can be dragged onto a folder's row, carrying this key;
// onDropCard: a dragged row's key, let go over this one.
export type TableRow = { key: string; cells: (ReactNode | null)[]; summary?: ReactNode; current?: boolean; icon?: LucideIcon; selected?: boolean; drag?: string; onDropCard?: (key: string) => void; onClick?: () => void };

const TRACKS = { name: 'minmax(0, 2fr)', fill: 'minmax(0, 1fr)', figure: 'var(--table-figure-width)', button: 'var(--control-md)' };

// Things compared by the same few facts. Each row opens its thing, or holds its own controls (no onClick).
export function Table({ label, columns, rows }: { label: string; columns: TableColumn[]; rows: TableRow[] }) {
  const tracks = {
    '--table-wide': columns.map((column) => TRACKS[column.size]).join(' '),
    '--table-narrow': columns.filter((column, index) => index === 0 || column.keep).map((_, index) => (index === 0 ? 'minmax(0, 1fr)' : 'auto')).join(' '),
  } as CSSProperties;
  const cell = (column: TableColumn, index: number) =>
    [column.size === 'button' ? styles.control : styles.cell, column.size === 'figure' && styles.figure, index > 0 && !column.keep && styles.drop].filter(Boolean).join(' ');
  return (
    <div className={styles.table} style={tracks}>
      {/* Hidden from the reader: each cell says its own column's name, which a row read as one button would lose. */}
      <div className={`${styles.row} ${styles.head}`} aria-hidden>
        {columns.map((column, index) => (
          <span key={column.label || index} className={cell(column, index)}>{column.label}</span>
        ))}
      </div>
      <ul className={styles.rows} aria-label={label}>
        {rows.map((row) => {
          const lead = (content: ReactNode) => <span className={styles.lead}>{content}</span>;
          const cells = row.cells.map((content, index) => (
            <span key={index} className={cell(columns[index]!, index)}>
              {index > 0 && columns[index]!.label && <span className={a11y.srOnly}>{columns[index]!.label} </span>}
              {index === 0 ? (
                <span className={styles.first}>
                  {row.icon ? (
                    <span className={styles.marked}>
                      <Icon icon={row.icon} size="sm" />
                      {lead(content)}
                    </span>
                  ) : (
                    lead(content)
                  )}
                  {row.summary && <span className={styles.summary}>{row.summary}</span>}
                </span>
              ) : content === null ? (
                <span className={styles.none} aria-label="없음">—</span>
              ) : (
                content
              )}
            </span>
          ));
          return <Line key={row.key} row={row}>{cells}</Line>;
        })}
      </ul>
    </div>
  );
}

function Line({ row, children }: { row: TableRow; children: ReactNode }) {
  const drop = useCardDrop(row.onDropCard);
  return (
    <li {...(row.drag === undefined ? {} : cardDrag(row.drag))} {...drop.props}>
      {row.onClick ? (
        <button type="button" className={[styles.row, styles.open, drop.over && styles.dropping].filter(Boolean).join(' ')} aria-current={row.current || undefined} aria-pressed={row.selected} onClick={row.onClick}>
          {children}
        </button>
      ) : (
        <div className={styles.row}>{children}</div>
      )}
    </li>
  );
}
