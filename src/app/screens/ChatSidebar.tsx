import { Lock, LogOut, MessageSquare, Plug, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { navigate, usePath } from '../router';
import { useChats, useTurn } from '../store';
import { useToast } from '../toast';
import { AccountRow, Avatar, Button, ChatRow, IconButton, MenuItem, NavRow, Popover, Rail, RailItem, SearchField, SideNote, Sidebar } from '../ui';
import { Welcome } from './HomeScreen';
import { ago } from './time';

const OPEN_CHAT = /^\/chats\/([0-9a-f-]{36})$/;

type Props = {
  // Phones: the list is the home screen.
  page: boolean;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  username: string;
  onLock: () => void;
  onLogout: () => Promise<string | null>;
};

export function ChatSidebar({ page, collapsed, onCollapse, username, onLock, onLogout }: Props) {
  const chats = useChats();
  const turn = useTurn();
  const path = usePath();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState(false);

  const open = OPEN_CHAT.exec(path)?.[1];
  const connections = path.startsWith('/connections');
  const words = query.trim().toLowerCase();
  const found = words ? chats.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(words)) : chats;

  const accountMenu = (
    <Popover
      open={account}
      onClose={() => setAccount(false)}
      place={collapsed && !page ? 'beside' : 'above-start'}
      label="계정"
      trigger={<IconButton icon={Settings} label="계정" size="sm" expanded={account} onClick={() => setAccount(!account)} />}
    >
      <MenuItem icon={Lock} label="잠그기" onClick={onLock} />
      <MenuItem
        icon={LogOut}
        label="로그아웃"
        onClick={() => {
          setAccount(false);
          void onLogout().then((failure) => failure && toast({ message: failure }));
        }}
      />
    </Popover>
  );

  if (collapsed && !page) {
    return (
      <Rail
        onExpand={() => onCollapse(false)}
        actions={<IconButton icon={Plus} label="새 채팅" onClick={() => navigate('/chats/new')} />}
        footer={
          <>
            <IconButton icon={Plug} label="연결" onClick={() => navigate('/connections')} />
            {accountMenu}
          </>
        }
      >
        {chats.map((item) => (
          <RailItem key={item.id} label={item.title} current={item.id === open} dot={turn?.chat === item.id ? 'accent' : undefined} onClick={() => navigate(`/chats/${item.id}`)}>
            <Avatar face={MessageSquare} />
          </RailItem>
        ))}
      </Rail>
    );
  }

  return (
    <Sidebar
      page={page}
      onCollapse={page ? undefined : () => onCollapse(true)}
      actions={
        chats.length > 0 || !page ? (
          <>
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => navigate('/chats/new')}>
              새 채팅
            </Button>
            {chats.length > 0 && <SearchField size="sm" label="채팅 검색" value={query} onChange={setQuery} />}
          </>
        ) : null
      }
      footer={
        <>
          <NavRow icon={Plug} label="연결" current={connections} onClick={() => navigate('/connections')} />
          <AccountRow avatar={<Avatar face={username} size="sm" tone="you" />} name={username}>
            {accountMenu}
          </AccountRow>
        </>
      }
    >
      {found.map((item) => (
        <ChatRow
          key={item.id}
          avatar={<Avatar face={MessageSquare} />}
          title={item.title}
          time={item.at === null ? '' : ago(item.at)}
          typing={turn?.chat === item.id}
          preview={item.preview}
          current={item.id === open}
          onClick={() => navigate(`/chats/${item.id}`)}
        />
      ))}
      {chats.length === 0 &&
        (page ? (
          <Welcome />
        ) : (
          <SideNote>아직 채팅이 없어요.</SideNote>
        ))}
      {chats.length > 0 && found.length === 0 && <SideNote>“{query.trim()}” 검색 결과가 없어요.</SideNote>}
    </Sidebar>
  );
}
