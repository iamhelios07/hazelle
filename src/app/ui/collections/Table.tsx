import type { CSSProperties, ReactNode } from 'react';
import a11y from '../foundation/a11y.module.css';
import styles from './Table.module.css';

// name: the row's own column, wider than the rest; figure: a count or a size, set right; button: a row's ⋯.
// keep: still shown when the table is narrow, where every other column but the first gives way to the row's summary.
export type TableColumn = { label: string; size: 'name' | 'fill' | 'figure' | 'button'; keep?: boolean };

// A null cell is something the row does not have, drawn as a dash. summary: the row's other columns as one line, shown
// under its first cell when the table is narrow.
export type TableRow = { key: string; cells: (ReactNode | null)[]; summary?: ReactNode; current?: boolean; onClick?: () => void };

const TRACKS = { name: 'minmax(0, 2fr)', fill: 'minmax(0, 1fr)', figure: 'var(--table-figure-width)', button: 'var(--control-md)' };

// Things compared by the same few facts. Each row opens its thing, or holds its own controls (no onClick).
export function Table({ label, columns, rows }: { label: string; columns: TableColumn[]; rows: TableRow[] }) {
  const tracks = {
    '--table-wide': columns.map((column) => TRACKS[column.size]).join(' '),
    '--table-narrow': columns.filter((column, index) => index === 0 || column.keep).map((_, index) => (index === 0 ? 'minmax(0, 1fr)' : 'auto')).join(' '),
  } as CSSProperties;
  const cell = (column: TableColumn, index: number) =>
    [styles.cell, column.size === 'figure' && styles.figure, index > 0 && !column.keep && styles.drop].filter(Boolean).join(' ');
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
          const cells = row.cells.map((content, index) => (
            <span key={index} className={cell(columns[index]!, index)}>
              {index > 0 && columns[index]!.label && <span className={a11y.srOnly}>{columns[index]!.label} </span>}
              {index === 0 ? (
                <span className={styles.first}>
                  <span className={styles.lead}>{content}</span>
                  {row.summary && <span className={styles.summary}>{row.summary}</span>}
                </span>
              ) : content === null ? (
                <span className={styles.none} aria-label="없음">—</span>
              ) : (
                content
              )}
            </span>
          ));
          return (
            <li key={row.key}>
              {row.onClick ? (
                <button type="button" className={`${styles.row} ${styles.open}`} aria-current={row.current || undefined} onClick={row.onClick}>
                  {cells}
                </button>
              ) : (
                <div className={styles.row}>{cells}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
