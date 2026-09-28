import { useEffect, useState, type ReactNode } from 'react';
import { CONNECTION_TYPES } from '../connectors/registry';
import { api } from '../runtime/api';
import type { OpenVault } from '../runtime/blobs';
import { forgetCatalogs } from '../runtime/catalog';
import { forgetCredentials } from '../runtime/credential';
import { purgeExpired } from '../runtime/library';
import { keepSynced, ObjectStore } from '../runtime/store';
import { Talk } from '../runtime/talk';
import type { VaultKey } from '../vault/keys';
import { usePath } from './router';
import { CharacterEditScreen } from './screens/CharacterEditScreen';
import { CharacterScreen } from './screens/CharacterScreen';
import { ChatScreen } from './screens/ChatScreen';
import { ConnectionAddScreen } from './screens/ConnectionAddScreen';
import { ConnectionDirectScreen } from './screens/ConnectionDirectScreen';
import { ConnectionKeyScreen } from './screens/ConnectionKeyScreen';
import { ConnectionModelsScreen } from './screens/ConnectionModelsScreen';
import { ConnectionSignInScreen } from './screens/ConnectionSignInScreen';
import { ConnectionsScreen } from './screens/ConnectionsScreen';
import { describeFailure } from './screens/failure';
import { GalleryScreen } from './screens/GalleryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ImportProvider } from './screens/ImportFlow';
import { LibrarySidebar } from './screens/LibrarySidebar';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { StoreProvider, TalkProvider, VaultProvider, useLibrary } from './store';
import { ToastProvider } from './toast';
import { ListDetail, Screen, Shell, Text, useSplit, useWide } from './ui';

type Account = { username: string; onLock: () => void; onLogout: () => Promise<string | null> };
type Props = Account & { accountId: string; vaultKey: VaultKey };

// Everything behind an open vault: the account's objects, pulled once before the first screen and
// kept in sync while the vault stays open, and the reply being written, which stops with it.
export function Workspace({ accountId, vaultKey, ...account }: Props) {
  const [open, setOpen] = useState<{ store: ObjectStore; talk: Talk; vault: OpenVault } | null>(null);
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
      const talk = new Talk(opened, account.username);
      const stopSync = keepSynced(opened);
      stop = () => {
        stopSync();
        talk.close();
      };
      const vault = { accountId, vaultKey, request: api };
      setOpen({ store: opened, talk, vault });
      void purgeExpired(opened, vault, Date.now());
    })();
    return () => {
      current = false;
      stop();
      forgetCatalogs();
      forgetCredentials();
    };
  }, [accountId, vaultKey, account.username, attempt]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((count) => count + 1)} />;
  if (!open) return null;
  return (
    <StoreProvider value={open.store}>
      <VaultProvider value={open.vault}>
        <TalkProvider value={open.talk}>
          <ToastProvider>
            <ImportProvider>
              <Layout {...account} />
            </ImportProvider>
          </ToastProvider>
        </TalkProvider>
      </VaultProvider>
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
    <LibrarySidebar page={page} collapsed={collapsed} onCollapse={collapse} username={username} onLock={onLock} onLogout={onLogout} />
  );

  // On phones the character list is the home screen, a character's chats are its page, and every
  // other page takes the whole screen.
  if (!wide) return path === '/' || SHELF.test(path) ? sidebar(true) : <Page path={path} username={username} />;
  return (
    <Shell side={sidebar(false)}>
      <Page path={path} username={username} />
    </Shell>
  );
}

const CHAT = /^\/chats\/([0-9a-f-]{36})$/;
const SHELF = /^\/characters\/([0-9a-f-]{36}|none)$/;
const NEW_CHAT = /^\/characters\/([0-9a-f-]{36})\/new$/;
const ABOUT = /^\/characters\/([0-9a-f-]{36})\/about$/;
const EDIT = /^\/characters\/([0-9a-f-]{36})\/edit$/;
const CONNECTION = /^\/connections\/([0-9a-f-]{36})$/;

function Page({ path, username }: { path: string; username: string }) {
  const split = useSplit();
  if (path === '/chats/new') return <ChatScreen key="new" id={null} character={null} username={username} />;
  const fresh = NEW_CHAT.exec(path)?.[1];
  if (fresh) return <ChatScreen key={`new-${fresh}`} id={null} character={fresh} username={username} />;
  const chat = CHAT.exec(path)?.[1];
  if (chat) return <ChatScreen key={chat} id={chat} character={null} username={username} />;
  if (path === '/characters') return <GalleryScreen />;
  const shelf = SHELF.exec(path)?.[1];
  if (shelf) return <CharacterScreen key={shelf} id={shelf === 'none' ? null : shelf} />;
  const about = ABOUT.exec(path)?.[1];
  if (about) return <CharacterScreen key={about} id={about} />;
  const edit = EDIT.exec(path)?.[1];
  if (edit) return <CharacterEditScreen key={edit} id={edit} />;
  const panes = connectionPanes(path);
  if (!panes) return <Home />;
  if (split) return <ListDetail list={panes.list} detail={panes.detail ?? <Placeholder text={panes.empty} />} />;
  return panes.detail ?? panes.list;
}

// The desktop home: every character, or before there is one, the first steps (F1).
function Home() {
  const { characters } = useLibrary();
  return characters.length ? <GalleryScreen /> : <HomeScreen />;
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
