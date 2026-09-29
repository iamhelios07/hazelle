import type { Connection } from '../../connectors/types';
import { addConnection } from '../../runtime/connections';
import type { Session } from '../../runtime/session';
import { describeAddFailure } from '../common/failure';
import { navigate } from '../shell/router';

// Saves a connection and opens its model list in place of the screen that made it, or says why it could not.
export async function connect(session: Session, connection: Connection, signal?: AbortSignal): Promise<string | null> {
  const added = await addConnection(session, connection, signal);
  if (!added.ok) return describeAddFailure(added.failure);
  navigate({ kind: 'connection', id: added.id }, { replace: true });
  return null;
}
