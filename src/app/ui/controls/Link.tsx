import { Download, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Link.module.css';

type Props = {
  href: string;
  // A file to save under this name, instead of a page to open.
  download?: string;
  children: ReactNode;
};

// A page opens in a new tab so the form here keeps what was typed.
export function Link({ href, download, children }: Props) {
  return download ? (
    <a className={styles.link} href={href} download={download}>
      {children}
      <Icon icon={Download} />
    </a>
  ) : (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon icon={ExternalLink} />
    </a>
  );
}
