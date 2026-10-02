import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { aliased } from '../common/alias';
import { matches, noResults, SEARCH_FROM } from '../common/search';
import { follows } from '../common/words';
import { usePersonas, useSettings } from '../session';
import { useToast } from '../toast';
import { Avatar, ChipButton, Divider, Empty, Menu, MenuHeading, MenuItem, SearchField, Tag } from '../ui';
import type { OpenChat } from './useChat';

// Without its own choice it follows the default, and a deleted one shows as missing.
export function ChatPersonaMenu({ chat }: { chat: OpenChat }) {
  const { persona, personaMenu } = chat;
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  const label = shown ? aliased(shown.name, shown.alias) : (persona.own ? '페르소나가 지워졌어요' : '기본 페르소나가 지워졌어요');
  return (
    <Menu
      handle={personaMenu}
      place="above-start"
      label="이 채팅에서 나는"
      trigger={(opener) => (
        <ChipButton
          label={label}
          title="이 채팅에서 나는"
          variant="ghost"
          opens="up"
          leading={<Avatar size="sm" tone="you" face={shown?.name ?? UserRound} image={shown?.picture} />}
          tone={shown ? 'default' : 'warn'}
          {...opener}
        />
      )}
    >
      <PersonaChoices chat={chat} />
      <Divider variant="menu" />
      <MenuItem label="페르소나 관리…" onClick={() => chat.actions.side({ kind: 'personas', id: null })} />
    </Menu>
  );
}

// Mounted only while the menu is open, so each opening starts with an empty search.
function PersonaChoices({ chat }: { chat: OpenChat }) {
  const { persona, actions } = chat;
  const personas = usePersonas();
  const settings = useSettings();
  const toast = useToast();
  const choose = (value: string | null) => void actions.setOwn('persona', value).then((saved) => saved.ok || toast.failed(saved));
  const fallback = personas.find(({ id }) => id === settings.persona);
  const own = persona.kind === 'persona' && persona.own ? persona.persona.id : null;
  const [query, setQuery] = useState('');
  const found = personas.filter(({ value }) => matches(query, value.name, value.alias ?? ''));
  return (
    <>
      {personas.length >= SEARCH_FROM && <SearchField size="sm" label="페르소나 검색" value={query} onChange={setQuery} />}
      <MenuHeading>이 채팅에서 나는</MenuHeading>
      {!query.trim() && (
        <MenuItem label={follows('기본 페르소나')} sub={fallback ? aliased(fallback.value.name, fallback.value.alias) : '기본 페르소나가 지워졌어요'} checked={!persona.own} onClick={() => choose(null)} />
      )}
      {found.length === 0 && <Empty variant="menu">{noResults(query.trim())}</Empty>}
      {found.map(({ id, value }) => (
        <MenuItem
          key={id}
          label={aliased(value.name, value.alias)}
          sub={value.description.split('\n')[0] || undefined}
          avatar={<Avatar tone="you" face={value.name} image={value.picture} />}
          tag={id === settings.persona ? <Tag tone="accent">기본</Tag> : undefined}
          checked={id === own}
          onClick={() => choose(id)}
        />
      ))}
    </>
  );
}
