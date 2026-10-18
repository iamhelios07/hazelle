import { Fragment, type ReactNode } from 'react';
import type { GroupHead, LineAt } from '../../model/toggles';
import { Disclosure, Divider, Row, Text } from '../ui';
import type { Laid, LaidLine, NoteLine } from './toggleLayout';
import { usePersisted } from './usePersisted';

type Props<T> = {
  // The id of the prompt, character or module whose list it is: the groups open in it are remembered on this device by
  // name, the same in a chat's 토글 and where the defaults are set.
  owner: string;
  items: readonly Laid<T>[];
  row: (row: T) => ReactNode;
  // An editor's ⋯ by a group's head, a divider or a caption.
  menu?: (line: LineAt<NoteLine | GroupHead>) => ReactNode;
};

// One look for a toggle list, in a chat's 토글 and where its owner sets the defaults: each group folded under its name.
const openNames = (stored: string): string[] => {
  const open: unknown = JSON.parse(stored);
  return Array.isArray(open) ? open.filter((name) => typeof name === 'string') : [];
};

export function ToggleList<T>({ owner, items, row, menu }: Props<T>) {
  const [open, setOpen] = usePersisted(`risu-alpha:open-toggle-groups:${owner}`, openNames, []);
  const note = ({ line, at }: LineAt<NoteLine>) => {
    const shown = line.kind === 'divider' ? <Divider label={line.label} /> : <Text variant="note">{line.label}</Text>;
    return menu ? (
      <Row key={`note${at}`} kind="spread">
        {shown}
        {menu({ line, at })}
      </Row>
    ) : (
      <Fragment key={`note${at}`}>{shown}</Fragment>
    );
  };
  const inner = (item: LaidLine<T>) => ('row' in item ? row(item.row) : note(item.note));
  return (
    <>
      {items.map((item) =>
        'group' in item ? (
          <Disclosure
            key={`group${item.group.at}`}
            label={item.group.line.label}
            menu={menu?.(item.group)}
            open={open.includes(item.group.line.label)}
            onOpen={(opened) => setOpen(opened ? [...open, item.group.line.label] : open.filter((name) => name !== item.group.line.label))}
          >
            {item.items.length > 0 ? item.items.map(inner) : <Text variant="note">비어 있는 그룹이에요.</Text>}
          </Disclosure>
        ) : (
          inner(item)
        ),
      )}
    </>
  );
}
