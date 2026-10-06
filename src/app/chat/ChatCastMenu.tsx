import { Users } from 'lucide-react';
import { useState } from 'react';
import { CAST_MAX } from '../../model/chat';
import { matches } from '../../model/library';
import { aliased } from '../common/alias';
import { noResults, SEARCH_FROM } from '../common/search';
import { CAST } from '../common/words';
import { useLibrary } from '../session';
import { Avatar, Empty, Menu, MenuHeading, MenuItem, SearchField, ToolButton } from '../ui';
import type { OpenChat } from './useChat';

// button false: a phone's header has no room for it, so there the menu opens from ⋯ (ChatHeaderActions).
export function ChatCastMenu({ chat, button }: { chat: OpenChat; button: boolean }) {
  const { cast, castMenu } = chat;
  return (
    <Menu
      handle={castMenu}
      place="below-end"
      size="lg"
      label={CAST}
      trigger={(opener) => button && <ToolButton icon={Users} label={CAST} detail={cast.length ? `${cast.length}명` : undefined} mark={{ kind: 'count', count: cast.length }} {...opener} />}
    >
      <CastChoices chat={chat} />
    </Menu>
  );
}

// Mounted only while the menu is open, so each opening starts with an empty search.
function CastChoices({ chat }: { chat: OpenChat }) {
  const { cast, shelf, actions } = chat;
  const { characters } = useLibrary();
  const [query, setQuery] = useState('');
  const offered = characters.filter(({ id }) => id !== shelf?.id);
  const found = offered.filter(({ character }) => matches(character, query));
  const gone = cast.filter((id) => !offered.some((each) => each.id === id));
  const full = cast.length >= CAST_MAX;
  const flip = (id: string) => actions.setCast(cast.includes(id) ? cast.filter((each) => each !== id) : [...cast, id]);
  return (
    <>
      {offered.length >= SEARCH_FROM && <SearchField size="sm" label="캐릭터 검색" value={query} onChange={setQuery} />}
      {full && <MenuHeading>{`최대 ${CAST_MAX}명`}</MenuHeading>}
      {found.length === 0 && <Empty variant="menu">{query.trim() ? noResults(query.trim()) : '선택할 수 있는 다른 캐릭터가 없어요.'}</Empty>}
      {found.map(({ id, character, face }) => (
        <MenuItem
          key={id}
          label={aliased(character.card.name, character.alias)}
          avatar={<Avatar face={character.card.name} image={face} />}
          checked={cast.includes(id)}
          multiple
          disabled={full && !cast.includes(id)}
          onClick={() => flip(id)}
        />
      ))}
      {gone.map((id) => (
        <MenuItem key={id} label="삭제된 캐릭터" tone="muted" checked multiple onClick={() => flip(id)} />
      ))}
    </>
  );
}
