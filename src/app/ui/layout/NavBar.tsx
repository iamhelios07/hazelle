import { ArrowLeft, ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { TitleField } from '../controls/TitleField';
import { MoreMenu } from '../overlays/MoreMenu';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

type Back = { backLabel: string; onBack: () => void; named?: boolean; close?: boolean } | { backLabel?: never; onBack?: never; named?: never; close?: never };
export type NavBarProps = {
  title: string;
  rename?: { label: string; placeholder: string; onChange: (title: string) => void };
  subtitle?: ReactNode;
  status?: string;
  actions?: ReactNode;
  // MenuItems for the thing the screen shows, under a ⋯ after the actions.
  menu?: { of: string; items: ReactNode };
} & Back;

export function NavBar({ title, rename, subtitle, status, backLabel, onBack, named = false, close = false, actions, menu }: NavBarProps) {
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
          <h1 className={styles.title}>{rename ? <TitleField label={rename.label} value={title} placeholder={rename.placeholder} onChange={rename.onChange} /> : title}</h1>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
      )}
      {status !== undefined && (
        <span className={styles.status} role="status">
          {status}
        </span>
      )}
      <ButtonSlot value="sm">{actions}</ButtonSlot>
      {menu && <MoreMenu of={menu.of}>{menu.items}</MoreMenu>}
    </div>
  );
}
