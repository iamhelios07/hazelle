import { useEffect, useState } from 'react';
import { CONNECTION_TYPES } from '../connectors/registry';
import { api } from '../runtime/api';
import { forgetCatalogs } from '../runtime/catalog';
import { forgetCredentials } from '../runtime/credential';
import { keepSynced, ObjectStore } from '../runtime/store';
import type { VaultKey } from '../vault/keys';
import { navigate, usePath } from './router';
import { ConnectionAddScreen } from './screens/ConnectionAddScreen';
import { ConnectionDirectScreen } from './screens/ConnectionDirectScreen';
import { ConnectionKeyScreen } from './screens/ConnectionKeyScreen';
import { ConnectionModelsScreen } from './screens/ConnectionModelsScreen';
import { ConnectionSignInScreen } from './screens/ConnectionSignInScreen';
import { ConnectionsScreen } from './screens/ConnectionsScreen';
import { describeFailure } from './screens/failure';
import { HomeScreen } from './screens/HomeScreen';
import { TryScreen } from './screens/TryScreen';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { StoreProvider, useConnections } from './store';
import { ToastProvider } from './toast';

type Props = { accountId: string; vaultKey: VaultKey; message: string | null; onLock: () => void; onLogout: () => void };

// Everything behind an open vault: the account's objects, pulled once before the first screen and
// kept in sync while the vault stays open.
export function Workspace({ accountId, vaultKey, ...home }: Props) {
  const [store, setStore] = useState<ObjectStore | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    let stopSync = () => {};
    setFailure(null);
    void (async () => {
      const opened = await ObjectStore.open(accountId, vaultKey, api);
      const pulled = await opened.pull();
      if (!current) return;
      if (pulled) {
        setFailure(describeFailure(pulled));
        return;
      }
      stopSync = keepSynced(opened);
      setStore(opened);
    })();
    return () => {
      current = false;
      stopSync();
      forgetCatalogs();
      forgetCredentials();
    };
  }, [accountId, vaultKey, attempt]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((count) => count + 1)} />;
  if (!store) return null;
  return (
    <StoreProvider value={store}>
      <ToastProvider>
        <Routes {...home} />
      </ToastProvider>
    </StoreProvider>
  );
}

const CONNECTION = /^\/connections\/([0-9a-f-]{36})$/;

function Routes({ message, onLock, onLogout }: Omit<Props, 'accountId' | 'vaultKey'>) {
  const path = usePath();
  const connections = useConnections();
  if (path === '/connections') return <ConnectionsScreen />;
  if (path === '/connections/new') return <ConnectionAddScreen />;
  if (path === '/connections/new/direct') return <ConnectionDirectScreen />;
  const type = CONNECTION_TYPES.find((candidate) => path === `/connections/new/${candidate.id}`);
  if (type?.signIn) return <ConnectionSignInScreen key={type.id} type={type} signIn={type.signIn} />;
  if (type) return <ConnectionKeyScreen key={type.id} type={type} />;
  if (path === '/try') return <TryScreen />;
  const id = CONNECTION.exec(path)?.[1];
  if (id) return <ConnectionModelsScreen key={id} id={id} />;
  return (
    <HomeScreen
      connectionCount={connections.length}
      onConnections={() => navigate(connections.length ? '/connections' : '/connections/new')}
      message={message}
      onLock={onLock}
      onLogout={onLogout}
    />
  );
}
