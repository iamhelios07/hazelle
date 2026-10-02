import { ChevronLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { matches, noResults, SEARCH_FROM } from '../../common/search';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useLibrary, useTurn } from '../../session';
import { Empty, FaceButton, FaceStrip, ItemRow, NavRow, SearchField, SideTitle, Sidebar } from '../../ui';
import { navigate, useRoute } from '../router';
import { characterPage, type Route } from '../routes';
import { SidebarFooter } from './SidebarFooter';

// The recent-characters strip fits five faces beside each other in the sidebar's width.
const STRIP = 5;

type Props = {
  page: boolean;
  onCollapse: (() => void) | undefined;
  shelf: Shelf<ChatSummary>;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  onUp: () => void;
};

// Keyed by its character, so the search starts empty in each.
export function ShelfChats({ page, onCollapse, shelf, typing, onEnter, onUp }: Props) {
  const [query, setQuery] = useState('');
  const found = shelf.chats.filter((item) => matches(query, item.title, item.preview ?? ''));
  const { characters } = useLibrary();
  const turn = useTurn();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const others = characters.filter((candidate) => candidate !== shelf && candidate.chats.length > 0).slice(0, STRIP);
  // 캐릭터 없이 has a page only beside its chats.
  const about: Route | null = shelf.id !== null ? characterPage(shelf.id, !page) : page ? null : { kind: 'shelf', character: null };
  return (
    <Sidebar
      page={page}
      onCollapse={onCollapse}
      actions={
        <>
          <NavRow icon={ChevronLeft} label="모든 캐릭터" onClick={onUp} />
          {others.length > 0 && (
            <FaceStrip label="최근 캐릭터">
              {others.map((other) => (
                <FaceButton key={other.id} label={shelfName(other)} dot={typing(other) ? 'accent' : undefined} onClick={() => onEnter(other)}>
                  <ShelfFace shelf={other} />
                </FaceButton>
              ))}
            </FaceStrip>
          )}
          <SideTitle avatar={<ShelfFace shelf={shelf} />} name={shelfName(shelf)} onOpen={about === null ? undefined : () => navigate(about)} />
          <NavRow icon={Plus} label="새 채팅" onClick={() => navigate({ kind: 'new-chat', character: shelf.id })} />
          {shelf.chats.length >= SEARCH_FROM && <SearchField size="sm" label="채팅 검색" value={query} onChange={setQuery} />}
        </>
      }
      current={openChat}
      footer={<SidebarFooter />}
    >
      {found.map((item) => (
        <ItemRow
          key={item.id}
          title={item.title}
          time={item.at === null ? '' : ago(item.at)}
          typing={turn?.chat === item.id}
          preview={item.preview ?? '아직 불러오지 않은 채팅'}
          current={item.id === openChat}
          onClick={() => navigate({ kind: 'chat', id: item.id })}
        />
      ))}
      {shelf.chats.length === 0 ? <Empty variant="side">{`${NO_CHATS}.`}</Empty> : found.length === 0 && <Empty variant="side">{noResults(query.trim())}</Empty>}
    </Sidebar>
  );
}
