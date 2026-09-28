import type { ReactNode } from 'react';
import styles from './Text.module.css';

type Props = { size?: 'sm' | 'md'; tone?: 'default' | 'muted' | 'accent'; align?: 'start' | 'center'; children: ReactNode };

export function Text({ size = 'md', tone = 'default', align = 'start', children }: Props) {
  const classes = [styles[size], tone !== 'default' && styles[tone], align === 'center' && styles.center].filter(Boolean).join(' ');
  return <p className={classes}>{children}</p>;
}
