import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, SelectionBar } from '../ui';

// counted: a count of picked things as the screen says it (3개, 캐릭터 3명). ask: the bar's words while none is picked.
// every: the ids 모두 선택 picks, where the screen offers it.
type Bar = { counted: (count: number) => string; ask: string; every?: readonly string[] };

// Picking several things on a screen: null while not picking. A press on a thing toggles it only while picking.
export function useSelection() {
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const start = () => setPicked(new Set());
  const clear = () => setPicked(null);
  const all = (ids: readonly string[]) => setPicked(new Set(ids));
  const toggle = (id: string) => {
    if (!picked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  return {
    picked,
    start,
    clear,
    all,
    toggle,
    // The head's button that starts picking, and ends it as 완료.
    button: (icon: LucideIcon, label: string) => (
      <Button variant="secondary" size="sm" icon={icon} onClick={picked ? clear : start}>
        {picked ? '완료' : label}
      </Button>
    ),
    // actions: what is done to the pick, after 취소.
    bar: ({ counted, ask, every }: Bar, actions: ReactNode) =>
      picked && (
        <SelectionBar>
          <span>{picked.size ? `${counted(picked.size)} 선택됨` : ask}</span>
          {every && (
            <Button variant="secondary" size="sm" onClick={() => all(every)}>
              모두 선택
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={clear}>
            취소
          </Button>
          {actions}
        </SelectionBar>
      ),
  };
}
