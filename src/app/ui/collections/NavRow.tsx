import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Item } from './Item';

type Props = { icon: LucideIcon; label: string; meta?: string; current?: boolean; onClick: () => void };

export function NavRow({ icon, label, meta, current, onClick }: Props) {
  return <Item density="compact" scheme="side" leading={<Icon icon={icon} size="xs" />} title={label} meta={meta} current={current} onClick={onClick} />;
}
