import type { Connection } from '../../connectors/types';
import { addConnection } from '../../runtime/connections';
import type { Session } from '../../runtime/session';
import { describeKeyFailure } from '../common/failure';
import { navigate } from '../shell/router';

// signal: the screen was left. Nothing is saved after that, and a save already on its way opens nothing.
export async function connect(session: Session, connection: Connection, signal: AbortSignal): Promise<string | null> {
  const added = await addConnection(session, connection, signal);
  if (!added.ok) return describeKeyFailure(added.failure);
  if (!signal.aborted) navigate({ kind: 'connection', id: added.id }, { replace: true });
  return null;
}
