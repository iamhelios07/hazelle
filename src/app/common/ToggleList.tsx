import { Fragment, type ReactNode } from 'react';
import type { GroupHead, LineAt } from '../../model/toggles';
import { Disclosure, Divider, Row, Text } from '../ui';
import type { Laid, LaidLine, NoteLine } from './toggleLayout';
import { storedStrings, usePersisted } from './usePersisted';

type Props<T> = {
  // The id of the prompt, character or module whose list it is: the groups open in it are remembered on this device by
  // name, the same in a chat's 토글 and where the defaults are set.
  owner: string;
  items: readonly Laid<T>[];
  row: (row: T) => ReactNode;
  // An editor's ⋯ by a group's head, a divider or a caption.
  menu?: (line: LineAt<NoteLine | GroupHead>) => ReactNode;
};

export function ToggleList<T>({ owner, items, row, menu }: Props<T>) {
  const [open, setOpen] = usePersisted(`risu-alpha:open-toggle-groups:${owner}`, storedStrings, []);
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
      {items.map((item) => {
        if (!('group' in item)) return inner(item);
        const name = item.group.line.label;
        const opened = open.includes(name);
        return (
          <Disclosure
            key={`group${item.group.at}`}
            label={name}
            menu={menu?.(item.group)}
            open={opened}
            onOpen={(next) => setOpen(next ? [...open, name] : open.filter((each) => each !== name))}
          >
            {opened && (item.items.length > 0 ? item.items.map(inner) : <Text variant="note">비어 있는 그룹이에요.</Text>)}
          </Disclosure>
        );
      })}
    </>
  );
}
