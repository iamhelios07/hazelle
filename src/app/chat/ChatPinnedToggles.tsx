import { ListChecks, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSettings } from '../session';
import { Menu, MenuItem, ToolButton } from '../ui';
import type { ToggleRow } from './toggles';
import type { OpenChat } from './useChat';

// 입력창에 고정: the pinned toggles this chat declares, in pin order. A text toggle is never pinned (ChatToggles).
type Props = { toggles: OpenChat['toggles']; onFlip: OpenChat['actions']['flip'] };

export function ChatPinnedToggles({ toggles, onFlip }: Props) {
  const pinned = useSettings().pinnedToggles ?? [];
  const rows = new Map(toggles.sections.flatMap((section) => section.rows).map((row) => [row.toggle.key, row]));
  return pinned.flatMap((key) => {
    const row = rows.get(key);
    return row ? [<Pinned key={key} row={row} flip={onFlip} />] : [];
  });
}

function Pinned({ row: { toggle, value }, flip }: { row: ToggleRow; flip: Props['onFlip'] }) {
  if (toggle.kind === 'check') {
    const on = value === '1';
    return <ToolButton icon={on ? ToggleRight : ToggleLeft} label={toggle.label} detail={on ? '켜짐' : '꺼짐'} pressed={on} onClick={() => flip(toggle.key, on ? '0' : '1')} />;
  }
  if (toggle.kind !== 'choice') return null;
  const picked = toggle.options[Number(value)] ?? value;
  return (
    <Menu place="above-start" label={toggle.label} trigger={(opener) => <ToolButton icon={ListChecks} label={`${toggle.label} · ${picked}`} {...opener} />}>
      {toggle.options.map((option, index) => (
        <MenuItem key={index} label={option} checked={String(index) === value} onClick={() => flip(toggle.key, String(index))} />
      ))}
    </Menu>
  );
}
