import { ChevronLeft, Import, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { openCharacter } from '../../chat/editBeside';
import { matches, noResults, SEARCH_FROM } from '../../common/search';
import { IMPORT_CHATS } from '../../common/words';
import { useImport } from '../../library/ImportFlow';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useWritingChats } from '../../session';
import { Button, Empty, ItemRow, NavRow, SearchField, SideTitle, Sidebar, Viewport } from '../../ui';
import { navigate, useRoute } from '../router';
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
  const { pickChats } = useImport();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const id = shelf.id;
  // 캐릭터 없이 has a page only beside its chats.
  const open = id !== null ? () => openCharacter(id, !page) : page ? undefined : () => navigate({ kind: 'shelf', character: null });
  return (
    <Sidebar
      page={page}
      actions={
        <>
          <NavRow icon={ChevronLeft} label="모든 캐릭터" onClick={onUp} />
          <SideTitle
            avatar={<ShelfFace shelf={shelf} />}
            name={shelfName(shelf)}
            onOpen={open}
          />
          <Button variant="secondary" size="md" icon={Plus} onClick={() => navigate({ kind: 'new-chat', character: shelf.id })}>
            새 채팅
          </Button>
          <Button variant="ghost" size="md" icon={Import} onClick={() => pickChats(shelf.id)}>
            {IMPORT_CHATS}
          </Button>
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
          preview={item.preview ?? '미리보기 없음'}
          current={item.id === openChat}
          onClick={() => navigate({ kind: 'chat', id: item.id })}
        />
        );
      }}</Viewport>
      {shelf.chats.length === 0 ? <Empty variant="side">{`${NO_CHATS}.`}</Empty> : found.length === 0 && <Empty variant="side">{noResults(query.trim())}</Empty>}
    </Sidebar>
  );
}
