import { useState } from 'react';
import { moved } from '../../model/fields';
import type { PackOwner } from '../../model/library';
import type { ToggleLine } from '../../model/prompt';
import { rekeyed } from '../../model/toggles';
import { setToggles } from '../../runtime/pack';
import { useStore } from '../session';
import { useToast } from '../toast';
import { TogglePane } from './TogglePane';

// A pack has no conditions of its own to rewrite with a key, and no undo: each change writes the list it makes.
export function PackToggles({ owner, lines }: { owner: PackOwner; lines: ToggleLine[] }) {
  const store = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const write = (next: ToggleLine[]) => void setToggles(store, owner, next).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  return (
    <TogglePane
      owner={owner.id}
      lines={lines}
      uses={null}
      onAdd={(added) => write([...lines, ...added])}
      onEdit={(_, after, at) => write(lines.with(at, after))}
      onMove={(_, { from, count, to }) => write(moved(lines, from, to, count))}
      onRekey={(toggle, to) => write(rekeyed(lines, toggle.key, to))}
      onRemove={(gone) => write(lines.filter((_, at) => !gone.some((line) => line.at === at)))}
      adding={adding}
      onAdding={setAdding}
    />
  );
}
