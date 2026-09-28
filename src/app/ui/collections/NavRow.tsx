import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Item } from './Item';

type Props = { icon: LucideIcon; label: string; current?: boolean; onClick: () => void };

// A place in the app, at the foot of the sidebar.
export function NavRow({ icon, label, current, onClick }: Props) {
  return <Item density="compact" scheme="side" leading={<Icon icon={icon} size="xs" />} title={label} current={current} onClick={onClick} />;
}
