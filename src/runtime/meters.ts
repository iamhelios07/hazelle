import { resolveConnection } from '../connectors/registry';
import type { Connection, Meter } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type MetersFailure = RelayFailure | { kind: 'not-meters' };
// A request that failed adds nothing to meters and its failure to failures; the others still answer.
export type MetersResult = { meters: Meter[]; failures: MetersFailure[] };

// null for a connection whose type reports no meters. Not cached: the figures move with every reply.
export function loadMeters(connection: Connection, signal?: AbortSignal): Promise<MetersResult> | null {
  const requests = resolveConnection(connection)?.type?.meters;
  if (!requests) return null;
  return Promise.all(
    requests.map(async ({ request, parse }): Promise<Meter[] | MetersFailure> => {
      const answer = await relayJson(request(connection.secret), signal);
      if (!answer.ok) return answer.failure;
      return parse(answer.data) ?? { kind: 'not-meters' };
    }),
  ).then((answers) => ({
    meters: answers.flatMap((answer) => (Array.isArray(answer) ? answer : [])),
    failures: answers.flatMap((answer) => (Array.isArray(answer) ? [] : [answer])),
  }));
}
