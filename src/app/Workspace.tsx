import { useEffect, useState, type ReactNode } from 'react';
import { CONNECTION_TYPES } from '../connectors/registry';
import { api } from '../runtime/api';
import { forgetCatalogs } from '../runtime/catalog';
import { forgetCredentials } from '../runtime/credential';
import { keepSynced, ObjectStore } from '../runtime/store';
import { Talk } from '../runtime/talk';
import type { VaultKey } from '../vault/keys';
import { usePath } from './router';
import { ChatScreen } from './screens/ChatScreen';
import { ChatSidebar } from './screens/ChatSidebar';
import { ConnectionAddScreen } from './screens/ConnectionAddScreen';
import { ConnectionDirectScreen } from './screens/ConnectionDirectScreen';
import { ConnectionKeyScreen } from './screens/ConnectionKeyScreen';
import { ConnectionModelsScreen } from './screens/ConnectionModelsScreen';
import { ConnectionSignInScreen } from './screens/ConnectionSignInScreen';
import { ConnectionsScreen } from './screens/ConnectionsScreen';
import { describeFailure } from './screens/failure';
import { HomeScreen } from './screens/HomeScreen';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { StoreProvider, TalkProvider } from './store';
import { ToastProvider } from './toast';
import { ListDetail, Screen, Shell, Text, useSplit, useWide } from './ui';

type Account = { username: string; onLock: () => void; onLogout: () => Promise<string | null> };
type Props = Account & { accountId: string; vaultKey: VaultKey };

// Everything behind an open vault: the account's objects, pulled once before the first screen and
// kept in sync while the vault stays open, and the reply being written, which stops with it.
export function Workspace({ accountId, vaultKey, ...account }: Props) {
  const [open, setOpen] = useState<{ store: ObjectStore; talk: Talk } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    let stop = () => {};
    setFailure(null);
    void (async () => {
      const opened = await ObjectStore.open(accountId, vaultKey, api);
      const pulled = await opened.pull();
      if (!current) return;
      if (pulled) {
        setFailure(describeFailure(pulled));
        return;
      }
      const talk = new Talk(opened);
      const stopSync = keepSynced(opened);
      stop = () => {
        stopSync();
        talk.close();
      };
      setOpen({ store: opened, talk });
    })();
    return () => {
      current = false;
      stop();
      forgetCatalogs();
      forgetCredentials();
    };
  }, [accountId, vaultKey, attempt]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((count) => count + 1)} />;
  if (!open) return null;
  return (
    <StoreProvider value={open.store}>
      <TalkProvider value={open.talk}>
        <ToastProvider>
          <Layout {...account} />
        </ToastProvider>
      </TalkProvider>
    </StoreProvider>
  );
}

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

// A per-device convenience: private windows may refuse storage, and then the sidebar starts open.
function remembered(): boolean {
  try {
    return localStorage.getItem(COLLAPSED) === '1';
  } catch {
    return false;
  }
}

function Layout({ username, onLock, onLogout }: Account) {
  const path = usePath();
  const wide = useWide();
  const [collapsed, setCollapsed] = useState(remembered);

  const collapse = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED, next ? '1' : '0');
    } catch {
      // Remembering is a convenience only.
    }
  };
  const sidebar = (page: boolean) => (
    <ChatSidebar page={page} collapsed={collapsed} onCollapse={collapse} username={username} onLock={onLock} onLogout={onLogout} />
  );

  // On phones the chat list is the home screen, and every other page takes the whole screen.
  if (!wide) return path === '/' ? sidebar(true) : <Page path={path} username={username} />;
  return (
    <Shell side={sidebar(false)}>
      <Page path={path} username={username} />
    </Shell>
  );
}

const CHAT = /^\/chats\/([0-9a-f-]{36})$/;
const CONNECTION = /^\/connections\/([0-9a-f-]{36})$/;

function Page({ path, username }: { path: string; username: string }) {
  const split = useSplit();
  if (path === '/chats/new') return <ChatScreen key="new" id={null} username={username} />;
  const chat = CHAT.exec(path)?.[1];
  if (chat) return <ChatScreen key={chat} id={chat} username={username} />;
  const panes = connectionPanes(path);
  if (!panes) return <HomeScreen />;
  if (split) return <ListDetail list={panes.list} detail={panes.detail ?? <Placeholder text={panes.empty} />} />;
  return panes.detail ?? panes.list;
}

// The connection screens as a list and the item picked from it, which sit side by side when there is
// room (design F5, desktop). empty is what the detail says before anything is picked.
function connectionPanes(path: string): { list: ReactNode; detail: ReactNode | null; empty: string } | null {
  const connections = { list: <ConnectionsScreen />, empty: '연결을 고르면 모델 목록과 사용량이 여기에 보여요.' };
  const add = { list: <ConnectionAddScreen />, empty: '왼쪽에서 연결할 곳을 고르면 여기서 이어서 연결해요.' };
  if (path === '/connections') return { ...connections, detail: null };
  if (path === '/connections/new') return { ...add, detail: null };
  if (path === '/connections/new/direct') return { ...add, detail: <ConnectionDirectScreen /> };
  const type = CONNECTION_TYPES.find((candidate) => path === `/connections/new/${candidate.id}`);
  if (type?.signIn) return { ...add, detail: <ConnectionSignInScreen key={type.id} type={type} signIn={type.signIn} /> };
  if (type) return { ...add, detail: <ConnectionKeyScreen key={type.id} type={type} /> };
  const id = CONNECTION.exec(path)?.[1];
  if (id) return { ...connections, detail: <ConnectionModelsScreen key={id} id={id} /> };
  return null;
}

function Placeholder({ text }: { text: string }) {
  return (
    <Screen align="center">
      <Text tone="muted" align="center">
        {text}
      </Text>
    </Screen>
  );
}
