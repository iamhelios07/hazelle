import { useSyncExternalStore } from 'react';
import type { Kind, Stored } from '../../model/kinds';
import { useSession } from '../session';

const subscribeNothing = () => () => {};
const snapshotNull = () => null;

export function useStored<K extends Kind>(kind: K, id: string | null): Stored<K> | null {
  const { read } = useSession();
  const model = id === null ? null : read.object(kind, id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}
