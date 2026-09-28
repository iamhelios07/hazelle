import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Link.module.css';

// A page on another site, opened in a new tab so the form here keeps what was typed.
export function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon icon={ExternalLink} />
    </a>
  );
}
