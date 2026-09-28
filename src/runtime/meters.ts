import { resolveConnection } from '../connectors/registry';
import type { Connection, Meter } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type MetersFailure = RelayFailure | { kind: 'not-meters' };
export type MetersResult = { ok: true; meters: Meter[] } | { ok: false; failure: MetersFailure };

export const reportsMeters = (connection: Connection) => Boolean(resolveConnection(connection)?.type?.meters);

// null for a connection whose type reports no meters. Not cached: the figures move with every reply.
export function loadMeters(connection: Connection, signal?: AbortSignal): Promise<MetersResult> | null {
  const meters = resolveConnection(connection)?.type?.meters;
  if (!meters) return null;
  return relayJson(meters.request(connection.secret), signal).then((answer): MetersResult => {
    if (!answer.ok) return answer;
    const parsed = meters.parse(answer.data);
    return parsed ? { ok: true, meters: parsed } : { ok: false, failure: { kind: 'not-meters' } };
  });
}
