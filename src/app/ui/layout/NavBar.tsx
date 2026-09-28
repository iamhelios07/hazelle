import { ArrowLeft, ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

// Without onBack there is no back: a settings page on wide screens, whose way back is the settings sidebar.
// named: beside a list, back is a link naming where it goes, for a page opened from the item picked there
// (a model's settings from its connection); elsewhere it is the usual back. close: back leaves a layer, as an ×.
type Back = { backLabel: string; onBack: () => void; named?: boolean; close?: boolean } | { backLabel?: never; onBack?: never; named?: never; close?: never };
type Props = { title: string; subtitle?: string; actions?: ReactNode } & Back;

// The top row of every screen below home: back, the screen's name, and its own actions. Beside its
// list (ListDetail) a screen has nothing to go back to.
export function NavBar({ title, subtitle, backLabel, onBack, named = false, close = false, actions }: Props) {
  const pane = usePane();
  const inPane = named && pane === 'detail';
  const back =
    onBack &&
    (inPane ? (
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
        {backLabel}
      </Button>
    ) : (
      pane !== 'detail' && (
        <span className={styles.back}>
          <IconButton icon={close ? X : ChevronLeft} label={backLabel} onClick={onBack} />
        </span>
      )
    ));
  return (
    <div className={styles.bar}>
      {back}
      {/* Beside a list the page's body carries its title, under the named back. */}
      {inPane ? (
        <span className={styles.titles} />
      ) : (
        <div className={styles.titles}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      )}
      {actions}
    </div>
  );
}
