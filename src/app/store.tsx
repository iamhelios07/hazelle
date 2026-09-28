import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Connection } from '../connectors/types';
import { SETTINGS_ID, type Settings } from '../runtime/docs';
import type { ObjectStore, Stored } from '../runtime/store';

const StoreContext = createContext<ObjectStore | null>(null);

export const StoreProvider = StoreContext.Provider;

export function useStore(): ObjectStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

// The store's version is the snapshot, and lists are rebuilt only when it changes: a selector that
// returned a fresh array every time would make React re-render forever.
function useVersion(store: ObjectStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

export function useConnections(): Stored<Connection>[] {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.list<Connection>('connection'), [store, version]);
}

export function useConnection(id: string): Stored<Connection> | null {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get<Connection>(id), [store, version, id]);
}

// Until something is saved, nothing is assigned: an empty layer, not a guessed default.
export function useSettings(): Settings {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.get<Settings>(SETTINGS_ID)?.value ?? { models: {} }, [store, version]);
}

export function useUnreadable(): number {
  const store = useStore();
  const version = useVersion(store);
  return useMemo(() => store.unreadable(), [store, version]);
}
