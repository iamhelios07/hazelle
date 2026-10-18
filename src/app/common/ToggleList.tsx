import { Fragment, type ReactNode } from 'react';
import type { GroupHead, LineAt } from '../../model/toggles';
import { Disclosure, Divider, Row, Text } from '../ui';
import type { Laid, LaidLine, NoteLine } from './toggleLayout';

type Props<T> = {
  items: readonly Laid<T>[];
  row: (row: T) => ReactNode;
  // An editor's ⋯ by a group's head, a divider or a caption.
  menu?: (line: LineAt<NoteLine | GroupHead>) => ReactNode;
};

// One look for a toggle list, in a chat's 토글 and where its owner sets the defaults: each group folded under its name.
export function ToggleList<T>({ items, row, menu }: Props<T>) {
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
          <Disclosure key={`group${item.group.at}`} label={item.group.line.label} menu={menu?.(item.group)}>
            {item.items.length > 0 ? item.items.map(inner) : <Text variant="note">비어 있는 그룹이에요.</Text>}
          </Disclosure>
        ) : (
          inner(item)
        ),
      )}
    </>
  );
}
