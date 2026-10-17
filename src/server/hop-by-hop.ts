import type { IncomingHttpHeaders } from 'node:http';

// Each describes one connection, as does every header Connection names, so a proxy ends them at itself. A Trailer
// forwarded on a bodyless request makes ClientRequest.end() throw, and the request fails instead of being answered.
export const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export function endToEnd(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const kept = { ...headers };
  const named = headers.connection?.split(',').map((name) => name.trim().toLowerCase()) ?? [];
  for (const name of [...HOP_BY_HOP, ...named]) delete kept[name];
  return kept;
}
