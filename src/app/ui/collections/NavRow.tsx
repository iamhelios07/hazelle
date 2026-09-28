import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Item } from './Item';

// meta: what the place holds now, at the row's end, such as a count.
type Props = { icon: LucideIcon; label: string; meta?: string; current?: boolean; onClick: () => void };

// A place in the app, at the foot of the sidebar; a part of a prompt, above its outline.
export function NavRow({ icon, label, meta, current, onClick }: Props) {
  return <Item density="compact" scheme="side" leading={<Icon icon={icon} size="xs" />} title={label} meta={meta} current={current} onClick={onClick} />;
}
