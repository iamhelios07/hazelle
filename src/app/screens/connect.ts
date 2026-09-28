import type { Connection } from '../../connectors/types';
import { loadCatalog } from '../../runtime/catalog';
import type { ObjectStore } from '../../runtime/store';
import { navigate } from '../router';
import { describeCatalogFailure, describeFailure } from './failure';

// F5's last step on every path: the model list must load before the connection is saved, so a wrong
// key is caught here. Answers the message to show, or null once the connection's models are open.
// Leaving the screen (signal) while the list loads saves nothing.
export async function connect(store: ObjectStore, connection: Connection, signal?: AbortSignal): Promise<string | null> {
  const catalog = await loadCatalog(connection, { fresh: true });
  if (signal?.aborted) return null;
  if (!catalog.ok) return describeCatalogFailure(catalog.failure);
  const id = crypto.randomUUID();
  const saved = await store.save<Connection>('connection', id, () => connection);
  if (!saved.ok) return describeFailure(saved);
  navigate(`/connections/${id}`, { replace: true });
  return null;
}
