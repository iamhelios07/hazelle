import { cacheView, chatRequest, resolveConnection, resolveModel, withCredential, type CacheView, type Resolved } from '../connectors/registry';
import { decodeStream, type Outcome } from '../connectors/stream';
import type { ModelSettings } from '../connectors/settings';
import { ConnectorError, type ChatMessage, type Connection, type HttpRequest, type Phase, type Starred } from '../connectors/types';
import type { Stored } from '../model/kinds';
import { routeOf } from './assignment';
import type { CredentialFailure, Credentials } from './credential';
import type { ObjectStore } from './store';
import { stream, type StreamCall } from './relay';

export type ReplyError =
  | { kind: 'refused'; code: string }
  | CredentialFailure
  | NonNullable<Outcome['error']>;

// The facts a receipt keeps: the outcome, and times measured from the moment of sending.
// A stop is a cut, never an error. request is the address and body the request was built with, for 요청 원문, and
// cache what its cache read and wrote; both null when it was refused before it could be built, or picked up after a reload.
// call: the call's id, which its receipt keeps (model/chat Receipt id); a call picked up after a reload has the same.
export type Reply = Omit<Outcome, 'error'> & {
  call: string;
  error: Exclude<ReplyError, { kind: 'stopped' }> | null;
  firstTextMs: number | null;
  totalMs: number;
  request: Pick<HttpRequest, 'url' | 'body'> | null;
  cache: CacheView | null;
};

export type GenerateInput = {
  credentials: Credentials;
  connection: Connection;
  model: Starred;
  settings: ModelSettings;
  messages: ChatMessage[];
  // The call's id and keys (runtime/streams newCall).
  call: StreamCall;
  signal: AbortSignal;
  onText: (phase: Phase, text: string) => void;
};

export async function generate({ credentials, connection, model, settings, messages, call, signal, onText }: GenerateInput): Promise<Reply> {
  const started = performance.now();
  let firstText: number | null = null;
  // Never the headers: the credential travels there, and leaving them out is the redaction that cannot leak.
  let built: Reply['request'] = null;
  let cached: CacheView | null = null;
  const reply = (outcome: Omit<Outcome, 'error'>, error: Reply['error']): Reply => ({
    ...outcome,
    call: call.id,
    error,
    firstTextMs: firstText === null ? null : Math.round(firstText - started),
    totalMs: Math.round(performance.now() - started),
    request: built,
    cache: cached,
  });
  const empty = { finishReason: null, usage: null, cost: null, replyId: null };

  // Refusals the connector can see coming are made here, before anything is sent.
  const resolved = resolveConnection(connection);
  if (!resolved) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'unknown-connection-type' });
  let route: Resolved;
  let request: HttpRequest;
  try {
    route = resolveModel(resolved, model);
    request = chatRequest(route, { model, messages, settings });
    built = { url: request.url, body: request.body };
    cached = cacheView(route, { model, messages, settings });
  } catch (error) {
    if (error instanceof ConnectorError) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: error.code });
    throw error;
  }

  const failed = (failure: CredentialFailure) =>
    failure.kind === 'stopped' ? reply({ state: 'cut', cut: 'stopped', ...empty }, null) : reply({ state: 'failed', cut: null, ...empty }, failure);
  const credential = await credentials.get(resolved, connection.secret, signal);
  if (!credential.ok) return failed(credential.failure);
  const response = await stream(call, withCredential(route, request, credential.credential), signal);
  if (!(response instanceof Response)) return failed(response);
  const outcome = await decodeStream(route, model, response, signal, (phase, text) => {
    firstText ??= performance.now();
    onText(phase, text);
  });
  return reply(outcome, outcome.error);
}

// What a request would cache, as generate builds it; null where generate would refuse it before sending.
export function cacheViewOf(connection: Connection, model: Starred, settings: ModelSettings, messages: ChatMessage[]): CacheView | null {
  const resolved = resolveConnection(connection);
  if (!resolved) return null;
  try {
    return cacheView(resolveModel(resolved, model), { model, messages, settings });
  } catch (error) {
    if (error instanceof ConnectorError) return null;
    throw error;
  }
}

// A call already running on the server (its marker), read from its start: what came while no page read it, then the
// live rest. Its request is gone, its time to first text unknown, and its duration the server's.
export async function resume(store: ObjectStore, { id, value }: Stored<'stream'>, signal: AbortSignal, onText: GenerateInput['onText']): Promise<Reply> {
  const call: StreamCall = { id, key: value.key };
  const empty = { finishReason: null, usage: null, cost: null, replyId: null };
  const reply = (outcome: Omit<Outcome, 'error'>, error: Reply['error']): Reply => ({ ...outcome, call: id, error, firstTextMs: null, totalMs: call.took ?? 0, request: null, cache: null });
  const route = routeOf(store, value.call);
  const resolved = 'kind' in route ? null : resolveConnection(route.connection.value);
  if ('kind' in route || !resolved) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'model-gone' });
  const response = await stream(call, null, signal);
  if (!(response instanceof Response)) return response.kind === 'stopped' ? reply({ state: 'cut', cut: 'stopped', ...empty }, null) : reply({ state: 'failed', cut: null, ...empty }, response);
  const outcome = await decodeStream(resolveModel(resolved, route.model), route.model, response, signal, onText);
  return reply(outcome, outcome.error);
}
