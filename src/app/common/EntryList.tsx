import { Plus, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useToast } from '../toast';
import { Button, IconButton } from '../ui';

type Entry<T> = { value: T; name: string; set: (value: T) => void; remove: ReactNode };

type Props<T> = {
  entries: T[];
  onChange: (entries: T[]) => void;
  // One entry's name by its place, such as 첫인사 2. Its delete button is named after it.
  name: (index: number) => string;
  // What a new entry holds.
  blank: T;
  addLabel: string;
  // The toast after a delete. The caller words it, so the particle after the noun is right.
  removed: (index: number) => string;
  children: (entry: Entry<T>) => ReactNode;
};

// Entries edited in place, in order, such as a card's greetings. Each renders through children with its
// delete button, and the add button puts a new one last. A delete takes effect at once and the toast
// offers 되돌리기 (design F3).
export function EntryList<T>({ entries, onChange, name, blank, addLabel, removed, children }: Props<T>) {
  const toast = useToast();
  function remove(index: number) {
    onChange(entries.filter((_, at) => at !== index));
    toast.undoable(removed(index), () => onChange(entries));
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
