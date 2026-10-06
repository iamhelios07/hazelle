import { ChevronLeft, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { openCharacterEditor } from '../../chat/editBeside';
import { matches, noResults, SEARCH_FROM } from '../../common/search';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useWritingChats } from '../../session';
import { Empty, IconButton, ItemRow, NavRow, SearchField, SideTitle, Sidebar, Viewport } from '../../ui';
import { navigate, useRoute } from '../router';
import { characterPage, type Route } from '../routes';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  page: boolean;
  shelf: Shelf<ChatSummary>;
  onUp: () => void;
};

// Keyed by its character, so the search starts empty in each.
export function ShelfChats({ page, shelf, onUp }: Props) {
  const [query, setQuery] = useState('');
  const found = useMemo(() => shelf.chats.filter((item) => matches(query, item.title, item.preview ?? '')), [shelf.chats, query]);
  const writing = useWritingChats();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  // 캐릭터 없이 has a page only beside its chats.
  const about: Route | null = shelf.id !== null ? characterPage(shelf.id, !page) : page ? null : { kind: 'shelf', character: null };
  const id = shelf.id;
  return (
    <Sidebar
      page={page}
      actions={
        <>
          <NavRow icon={ChevronLeft} label="모든 캐릭터" onClick={onUp} />
          <SideTitle
            avatar={<ShelfFace shelf={shelf} />}
            name={shelfName(shelf)}
            onOpen={about === null ? undefined : () => navigate(about)}
            action={id !== null && <IconButton icon={Pencil} label="캐릭터 편집" size="sm" onClick={() => openCharacterEditor(id)} />}
          />
          <NavRow icon={Plus} label="새 채팅" onClick={() => navigate({ kind: 'new-chat', character: shelf.id })} />
          {shelf.chats.length >= SEARCH_FROM && <SearchField size="sm" label="채팅 검색" value={query} onChange={setQuery} />}
        </>
      }
      footer={page && <SidebarFooter />}
    >
      <Viewport keys={found.map(({ id }) => id)} current={openChat}>{(index) => {
        const item = found[index]!;
        return (
        <ItemRow
          key={item.id}
          title={item.title}
          time={item.at === null ? '' : ago(item.at)}
          typing={writing.has(item.id)}
          preview={item.preview ?? '아직 불러오지 않은 채팅'}
          current={item.id === openChat}
          onClick={() => navigate({ kind: 'chat', id: item.id })}
        />
        );
      }}</Viewport>
      {shelf.chats.length === 0 ? <Empty variant="side">{`${NO_CHATS}.`}</Empty> : found.length === 0 && <Empty variant="side">{noResults(query.trim())}</Empty>}
    </Sidebar>
  );
}
