import type { Connection } from '../../connectors/types';
import { loadCatalog } from '../../runtime/catalog';
import { loadMeters } from '../../runtime/meters';
import type { ObjectStore } from '../../runtime/store';
import { navigate } from '../router';
import { describeCatalogFailure, describeFailure, describeMetersFailure } from './failure';

// F5's last step on every path: the model list must load before the connection is saved, and so must
// the meters where the type has them, because they are asked with the key while a model list may be
// public. A meters answer in an unfamiliar shape still came back, so it does not stop the save.
// Answers the message to show, or null once the connection's models are open. Leaving the screen
// (signal) while these load saves nothing.
export async function connect(store: ObjectStore, connection: Connection, signal?: AbortSignal): Promise<string | null> {
  const [catalog, meters] = await Promise.all([loadCatalog(connection, { fresh: true }), loadMeters(connection, signal)]);
  if (signal?.aborted) return null;
  if (!catalog.ok) return describeCatalogFailure(catalog.failure);
  if (meters && !meters.ok && meters.failure.kind !== 'not-meters') return describeMetersFailure(meters.failure);
  const id = crypto.randomUUID();
  const saved = await store.save<Connection>('connection', id, () => connection);
  if (!saved.ok) return describeFailure(saved);
  navigate(`/connections/${id}`, { replace: true });
  return null;
}
