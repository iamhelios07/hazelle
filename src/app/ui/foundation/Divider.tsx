import type { LucideIcon } from 'lucide-react';
import { Button } from '../controls/Button';
import styles from './Divider.module.css';
import { Icon } from './Icon';

type Story = { label: string; icon?: LucideIcon; action?: { label: string; onClick: () => void } };
type Props = Story | { variant: 'menu' | 'tools' | 'rail' };

export function Divider(props: Props) {
  if ('label' in props) {
    const { label, icon, action } = props;
    // A separator's children are presentational, so a line holding a button is not one.
    return (
      <div className={icon ? `${styles.story} ${styles.marked}` : styles.story} role={action ? undefined : 'separator'}>
        <span className={styles.rule} />
        {icon && <Icon icon={icon} size="xs" />}
        {label}
        {action && (
          <Button variant="link" size="xs" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        <span className={styles.rule} />
      </div>
    );
  }
  return <span className={styles[props.variant]} role={props.variant === 'menu' ? 'separator' : undefined} />;
}
