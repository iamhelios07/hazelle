import { Braces } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { PromptSort } from '../../model/prompt';
import { noResults } from '../common/search';
import { COMMAND } from '../common/words';
import { Button, Empty, Menu, MenuHeading, MenuItem, SearchField } from '../ui';
import { COMMANDS, type Command } from './commands';

type Props = { sort: PromptSort; onInsert: (command: Command) => void };

const LABEL = `${COMMAND} 넣기`;

export function CommandMenu({ sort, onInsert }: Props) {
  return (
    <Menu
      label={LABEL}
      place="below-end"
      size="lg"
      trigger={(opener) => (
        <Button variant="ghost" size="sm" icon={Braces} {...opener}>
          {LABEL}
        </Button>
      )}
    >
      <Commands sort={sort} onInsert={onInsert} />
    </Menu>
  );
}

const describe = ({ names, what, example }: Command) =>
  [what, example && `예: ${example[0]} → ${example[1]}`, names.length > 1 && `다른 이름: ${names.slice(1).join(', ')}`].filter(Boolean).join(' ');

// Mounted only while the menu is open, so each opening starts with an empty search.
function Commands({ sort, onInsert }: Props) {
  const [query, setQuery] = useState('');
  const groups = COMMANDS.filter((group) => !group.sorts || group.sorts.includes(sort));
  const words = query.trim().toLowerCase();
  const found = groups.flatMap((group) => group.commands).filter((command) => `${command.form} ${command.names.join(' ')} ${command.what}`.toLowerCase().includes(words));
  const item = (command: Command) => <MenuItem key={command.form} label={command.form} sub={describe(command)} onClick={() => onInsert(command)} />;

  return (
    <>
      <SearchField size="sm" label={`${COMMAND} 검색`} value={query} onChange={setQuery} />
      {words ? (
        found.length ? (
          <>
            <MenuHeading>검색 결과</MenuHeading>
            {found.map(item)}
          </>
        ) : (
          <Empty variant="menu">{noResults(query.trim())}</Empty>
        )
      ) : (
        groups.map((group) => (
          <Fragment key={group.title}>
            <MenuHeading>{group.title}</MenuHeading>
            {group.commands.map(item)}
          </Fragment>
        ))
      )}
    </>
  );
}
