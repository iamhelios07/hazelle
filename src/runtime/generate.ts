import { batchLane, cacheView, chatRequest, resolveConnection, resolveModel, withCredential, type CacheView, type Route } from '../connectors/registry';
import { decodeStream, type InlineThoughts, type Outcome } from '../connectors/stream';
import type { ModelSettings } from '../connectors/settings';
import { ConnectorError, type Account, type Batches, type ChatMessage, type Connection, type HttpRequest, type Model, type Phase, type Starred } from '../connectors/types';
import type { Stored } from '../model/kinds';
import { routeOf } from './assignment';
import type { CredentialFailure, Credentials } from './credential';
import type { PoolFailure } from './pool';
import type { ObjectStore } from './store';
import { pause } from './pause';
import { relay, relayJson, stream, type RelayFailure, type StreamCall } from './relay';

export type ReplyError =
  | { kind: 'refused'; code: string }
  | PoolFailure
  | CredentialFailure
  | NonNullable<Outcome['error']>;

// A stop is a cut, never an error. request is the address and body the request was built with, for 요청 원문, and
// cache what its cache read and wrote; both null when it was refused before it could be built, or picked up after a reload.
// call: the call's id, which its receipt keeps (model/chat Receipt id); a call picked up after a reload has the same.
// account: the id of the account it was sent with; null when none was picked, or it was picked up after a reload.
export type Reply = Omit<Outcome, 'error'> & {
  call: string;
  account: string | null;
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
  call: StreamCall;
  signal: AbortSignal;
  onText: (phase: Phase, text: string) => void;
  inline?: InlineThoughts;
  // A call that may be answered through a discount lane's batch: a chat reply's, never a task's (design §6.7: 보조 calls
  // never wait on a batch). waiting: told once the batch holds the call, whose marker then names it.
  batching?: { waiting: () => void };
};

// 멈추기 aborts a turn with this reason (Talk stop), which cancels a batch at the provider. Any other abort only stops
// waiting, and the batch stays with its marker for the next pick-up.
export const CANCEL = Symbol('cancel');

export async function generate({ credentials, connection, model, settings, messages, call, signal, onText, inline, batching }: GenerateInput): Promise<Reply> {
  const started = performance.now();
  let firstText: number | null = null;
  // Never the headers: the credential travels there, and leaving them out is the redaction that cannot leak.
  let built: Reply['request'] = null;
  let cached: CacheView | null = null;
  let account: Account | null = null;
  const reply = (outcome: Omit<Outcome, 'error'>, error: Reply['error']): Reply => ({
    ...outcome,
    call: call.id,
    account: account?.id ?? null,
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
  let route: Route;
  let request: HttpRequest;
  let batches: Batches | null;
  try {
    route = resolveModel(resolved, model);
    batches = batching ? batchLane(route, { model, messages, settings }) : null;
    // A batch answers whole, and both batch formats refuse a request that streams.
    request = chatRequest(route, { model, messages, settings: batches ? { ...settings, streaming: false } : settings });
    built = { url: request.url, body: request.body };
    cached = cacheView(route, { model, messages, settings });
  } catch (error) {
    if (error instanceof ConnectorError) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: error.code });
    throw error;
  }

  const picked = await credentials.pool.pick(connection);
  if (!picked.ok) return reply({ state: 'failed', cut: null, ...empty }, picked.failure);
  const serving = picked.account;
  account = serving;
  // A reply that failed leaves the account's meters to be read again before the next pick; it is never sent again on
  // another account.
  const failed = (failure: CredentialFailure) => {
    if (failure.kind === 'stopped') return reply({ state: 'cut', cut: 'stopped', ...empty }, null);
    credentials.pool.stale(connection, serving);
    return reply({ state: 'failed', cut: null, ...empty }, failure);
  };
  const credential = await credentials.get(resolved, serving.secret, signal);
  if (!credential.ok) return failed(credential.failure);
  const timed = (phase: Phase, text: string) => {
    firstText ??= performance.now();
    onText(phase, text);
  };
  if (batches) {
    const asking: Asking = { route, model, batches, ask: (each) => withCredential(route, each, credential.credential), signal, onText, inline };
    // Not stopped midway: a batch the provider made with no marker naming it would answer, and be billed, unread.
    const submitted = await relayJson(asking.ask(batches.submit(route.endpoint, model, request, call.id)));
    if (!submitted.ok) return failed(submitted.failure);
    const batch = batches.submitted(submitted.data);
    if (batch === null) {
      credentials.pool.stale(connection, serving);
      return reply(...failedWith({ kind: 'bad-event', detail: JSON.stringify(submitted.data).slice(0, 200) }));
    }
    // A batch stopped as it was made gets no marker, as a stream's call gets none (runtime/relay stream); waitBatch cancels it.
    if (signal.reason !== CANCEL) {
      call.started?.(batch);
      batching!.waiting();
    }
    const [outcome, error] = await waitBatch(asking, batch, call.id);
    if (error) credentials.pool.stale(connection, serving);
    return reply(outcome, error);
  }
  const response = await stream(call, withCredential(route, request, credential.credential), signal);
  if (!(response instanceof Response)) return failed(response);
  const outcome = await decodeStream(route, model, response, signal, timed, inline);
  if (outcome.error) credentials.pool.stale(connection, serving);
  return reply(outcome, outcome.error);
}

type Answered = [Omit<Outcome, 'error'>, Reply['error']];
const EMPTY = { finishReason: null, usage: null, cost: null, replyId: null };
const STOPPED: Answered = [{ state: 'cut', cut: 'stopped', ...EMPTY }, null];
const failedWith = (error: NonNullable<Reply['error']>): Answered => [{ state: 'failed', cut: null, ...EMPTY }, error];

// ask: a request with the account's credential added.
type Asking = { route: Route; model: Model; batches: Batches; ask: (request: HttpRequest) => HttpRequest; signal: AbortSignal; onText: GenerateInput['onText']; inline?: InlineThoughts };

// A batch is asked about through the relay, each ask a short call, so no server object holds it and a deploy cuts
// nothing. Soon at first, since a batch of one often ends within minutes, then once a minute.
const CHECKS_MS = [5_000, 10_000, 15_000, 30_000, 60_000];

// Failures worth waiting through: the page's own connection, and the provider busy or down for a moment.
const passing = (failure: Exclude<RelayFailure, { kind: 'stopped' }>) => failure.kind === 'offline' || failure.kind === 'relay' || (failure.kind === 'provider' && (failure.status === 429 || failure.status >= 500));

async function waitBatch(asking: Asking, batch: string, key: string): Promise<Answered> {
  const { route, batches, ask, signal } = asking;
  for (let tries = 0; ; tries++) {
    if (!(await pause(CHECKS_MS[Math.min(tries, CHECKS_MS.length - 1)]!, signal))) return signal.reason === CANCEL ? cancelBatch(asking, batch, key) : STOPPED;
    const checked = await relayJson(ask(batches.check(route.endpoint, batch)), signal);
    if (!checked.ok) {
      if (checked.failure.kind === 'stopped' || passing(checked.failure)) continue;
      return failedWith(checked.failure);
    }
    const ended = batches.ended(checked.data);
    if (ended === null) return failedWith({ kind: 'bad-event', detail: JSON.stringify(checked.data).slice(0, 200) });
    const read = ended && (await readBatch(asking, batch, key));
    if (read) return read;
  }
}

// A batch that answered before the cancel landed is billed all the same, so its answer is read and kept.
async function cancelBatch(asking: Asking, batch: string, key: string): Promise<Answered> {
  const { route, batches, ask } = asking;
  await relay(ask(batches.cancel(route.endpoint, batch)));
  const checked = await relayJson(ask(batches.check(route.endpoint, batch)));
  return (checked.ok && batches.ended(checked.data) && (await readBatch(asking, batch, key))) || STOPPED;
}

// Read to its end once the batch ended, a stop meanwhile included: the answer is billed. null: not read this time, for a
// failure worth waiting through, so the batch is asked about again.
async function readBatch({ route, model, batches, ask, signal, onText, inline }: Asking, batch: string, key: string): Promise<Answered | null> {
  const response = await relay(ask(batches.results(route.endpoint, batch)));
  if (!(response instanceof Response)) return response.kind === 'stopped' || passing(response) ? null : failedWith(response);
  let body: string;
  try {
    body = await response.text();
  } catch {
    return null;
  }
  const answer = batches.answer(body, key);
  if (!answer) return failedWith({ kind: 'bad-event', detail: body.slice(0, 200) });
  switch (answer.kind) {
    case 'canceled':
      return STOPPED;
    case 'expired':
      return failedWith({ kind: 'provider', detail: '정해진 시간 안에 처리되지 않아 만료됐어요.' });
    case 'failed':
      return failedWith({ kind: 'provider', detail: answer.detail });
    case 'reply': {
      const outcome = await decodeStream(route, model, new Response(JSON.stringify(answer.payload), { headers: { 'content-type': 'application/json' } }), signal, onText, inline, true);
      return [outcome, outcome.error];
    }
  }
}

// onText: told the whole text so far, not the chunk.
export function gather(onText?: (text: string) => void) {
  let text = '';
  return {
    add: (phase: Phase, chunk: string) => {
      if (phase !== 'text') return;
      text += chunk;
      onText?.(text);
    },
    value: () => text,
  };
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

// A call already running (its marker): on the server, read from its start, what came while no page read it, then the
// live rest; or a batch, asked about again. Its request is gone, its time to first text unknown, and its duration the
// server's, or for a batch the time until this page read its answer.
export async function resume({ store, credentials }: { store: ObjectStore; credentials: Credentials }, { id, value }: Stored<'stream'>, signal: AbortSignal, onText: GenerateInput['onText'], inline?: InlineThoughts): Promise<Reply> {
  let took = 0;
  const reply = ([outcome, error]: Answered): Reply => ({ ...outcome, call: id, account: null, error, firstTextMs: null, totalMs: took, request: null, cache: null });
  const route = routeOf(store, value.call);
  const resolved = 'kind' in route ? null : resolveConnection(route.connection.value);
  if ('kind' in route || !resolved) return reply(failedWith({ kind: 'refused', code: 'model-gone' }));
  const routed = resolveModel(resolved, route.model);
  if ('batch' in value) {
    const lane = routed.type?.discount;
    // A marker a newer version wrote, for a lane this one does not have.
    if (lane?.lane !== 'batch') return reply(failedWith({ kind: 'refused', code: 'unknown-connection-type' }));
    const credential = await credentials.get(resolved, route.connection.value.accounts[0]!.secret, signal);
    if (!credential.ok) return reply(credential.failure.kind === 'stopped' ? STOPPED : failedWith(credential.failure));
    const answered = await waitBatch({ route: routed, model: route.model, batches: lane.batches, ask: (each) => withCredential(routed, each, credential.credential), signal, onText, inline }, value.batch, id);
    took = Date.now() - value.at;
    return reply(answered);
  }
  const call: StreamCall = { id, key: value.key };
  const response = await stream(call, null, signal);
  took = call.took ?? 0;
  if (!(response instanceof Response)) return reply(response.kind === 'stopped' ? STOPPED : failedWith(response));
  const outcome = await decodeStream(routed, route.model, response, signal, onText, inline);
  took = call.took ?? 0;
  return reply([outcome, outcome.error]);
}
