import type { Connection } from '../../connectors/types';
import { loadCatalog } from '../../runtime/catalog';
import { loadMeters } from '../../runtime/meters';
import type { ObjectStore } from '../../runtime/store';
import { navigate } from '../router';
import { describeCatalogFailure, describeFailure, describeMetersFailure } from './failure';

// F5's last step on every path: the model list must load before the connection is saved. A model list
// may be public (OpenRouter's is), so a key the meters' request is refused with (401) stops the save
// too; any other trouble with the meters leaves them to their own block on the next screen.
// Answers the message to show, or null once the connection's models are open. Leaving the screen
// (signal) while these load saves nothing.
export async function connect(store: ObjectStore, connection: Connection, signal?: AbortSignal): Promise<string | null> {
  const [catalog, meters] = await Promise.all([loadCatalog(connection, { fresh: true }), loadMeters(connection, signal)]);
  if (signal?.aborted) return null;
  if (!catalog.ok) return describeCatalogFailure(catalog.failure);
  if (meters && !meters.ok && meters.failure.kind === 'provider' && meters.failure.status === 401) return describeMetersFailure(meters.failure);
  const saved = await store.create('connection', connection);
  if (!saved.ok) return describeFailure(saved);
  navigate(`/connections/${saved.data.id}`, { replace: true });
  return null;
}
