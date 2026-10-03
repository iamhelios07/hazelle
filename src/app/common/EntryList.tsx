import { Plus, Trash2 } from 'lucide-react';
import { Fragment, useRef, type ReactNode } from 'react';
import { useOwnUndo } from '../toast';
import { Button, IconButton } from '../ui';

type Entry<T> = { value: T; name: string; set: (value: T) => void; remove: ReactNode };

type Props<T> = {
  entries: T[];
  onChange: (entries: T[]) => void;
  name: (index: number) => string;
  blank: T;
  addLabel: string;
  // The caller words it, so the particle after the noun is right.
  removed: (index: number) => string;
  children: (entry: Entry<T>) => ReactNode;
};

// A delete takes effect at once and the toast offers 되돌리기, which puts the entry back into the list as it is then, at
// its old place or last when the list is shorter.
export function EntryList<T>({ entries, onChange, name, blank, addLabel, removed, children }: Props<T>) {
  const undoable = useOwnUndo();
  const latest = useRef({ entries, onChange });
  latest.current = { entries, onChange };
  function remove(index: number) {
    const gone = entries[index]!;
    onChange(entries.filter((_, at) => at !== index));
    undoable(removed(index), () => latest.current.onChange(latest.current.entries.toSpliced(index, 0, gone)));
  }
  return (
    <>
      {entries.map((value, index) => (
        <Fragment key={index}>
          {children({
            value,
            name: name(index),
            set: (next) => onChange(entries.map((old, at) => (at === index ? next : old))),
            remove: <IconButton icon={Trash2} label={`${name(index)} 지우기`} size="sm" onClick={() => remove(index)} />,
          })}
        </Fragment>
      ))}
      <Button variant="secondary" icon={Plus} onClick={() => onChange([...entries, blank])}>
        {addLabel}
      </Button>
    </>
  );
}
