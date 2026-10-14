import { unavailableCalibration } from '../model/token-calibration';
import { prepareChat, contextRefusal, type ContextRefusal } from '../connectors/preparation';
import type { CallCalibration } from '../model/token-calibration';
import { completedCalibration } from './token-calibration';
import { retryWait } from '../contracts/streams';
import { batchLane, cacheView, laneBusy, resolveConnection, resolveModel, retryOf, RETRYABLE, withCredential, type CacheView, type Route } from '../connectors/registry';
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
// tries: how many times it was sent (retry on failure); null where that is not known: never sent, or a call whose end
// was not read.
export type Reply = Omit<Outcome, 'error'> & {
  calibration: CallCalibration;
  contextRefusal: ContextRefusal | null;
  call: string;
  account: string | null;
  tries: number | null;
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
  // How many times a try that failed for a moment is sent again (connections retriesOf).
  retries: number;
  messages: ChatMessage[];
  call: StreamCall;
  signal: AbortSignal;
  onText: (phase: Phase, text: string) => void;
  inline?: InlineThoughts;
  // A call that may be answered through a discount lane's batch: a chat reply's, never a task's (design §6.7: 보조 calls
  // never wait on a batch). waiting: told once the batch holds the call, whose marker then names it. cancel: 멈추기,
  // which cancels the batch at the provider (waitBatch); signal only stops waiting, and leaves it to its marker.
  batching?: { waiting: () => void; cancel: AbortSignal };
};

export async function generate({ credentials, connection, model, settings, retries, messages, call, signal, onText, inline, batching }: GenerateInput): Promise<Reply> {
  const started = performance.now();
  let firstText: number | null = null;
  // Never the headers: the credential travels there, and leaving them out is the redaction that cannot leak.
  let built: Reply['request'] = null;
  let cached: CacheView | null = null;
  let account: Account | null = null;
  let tries: number | null = null;
  let protocol = "";
  const reply = (outcome: Omit<Outcome, 'error'>, error: Reply['error']): Reply => {
    const refusal = error?.kind === 'provider' ? contextRefusal(protocol, error) : null;
    const calibration = completedCalibration(call.calibration ?? unavailableCalibration('preparation'), outcome);
    return {
      ...outcome,
      ...(refusal && { usage: null, cost: null }),
      calibration: refusal ? { ...calibration, eligible: false, refusal } : calibration,
      contextRefusal: refusal,
      call: call.id,
      account: account?.id ?? null,
      tries,
      error,
      firstTextMs: firstText === null ? null : Math.round(firstText - started),
      totalMs: Math.round(performance.now() - started),
      request: built,
      cache: cached,
    };
  };
  const empty = { finishReason: null, usage: null, cost: null, replyId: null };

  // Refusals the connector can see coming are made here, before anything is sent.
  const resolved = resolveConnection(connection);
  if (!resolved) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'unknown-connection-type' });
  let route: Route;
  let request: HttpRequest;
  let batches: Batches | null;
  const asked = { model, messages, settings };
  try {
    route = resolveModel(resolved, model);
    protocol = route.endpoint.protocol;
    batches = batching ? batchLane(route, asked) : null;
    // A batch answers whole, and both batch formats refuse a request that streams.
    const prepared = prepareChat(route, { model, messages, settings: batches ? { ...settings, streaming: false } : settings });
    request = prepared.request;
    if (call.measure) call.calibration = { ...(call.calibration ?? unavailableCalibration('preparation')), measurement: await call.measure(prepared) };
    if (call.preflight) {
      const checked = await call.preflight(settings, signal);
      if (!checked.ok) return checked.error === 'stopped' ? reply(...STOPPED) : reply({ state: 'failed', cut: null, ...empty }, { kind: 'app', code: checked.error });
      call.calibration = { ...(call.calibration ?? unavailableCalibration('preparation')), fit: checked.data };
    }
    const calibration = call.calibration;
    if (calibration?.fit) {
      if (calibration.measurement.kind !== 'measured') return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'tokenizer' });
      if (calibration.fit.allowance !== null && calibration.measurement.o200k > calibration.fit.allowance) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'context-fit' });
    }
    built = { url: request.url, body: request.body };
    cached = cacheView(route, asked);
  } catch (error) {
    if (error instanceof ConnectorError) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: error.code });
    throw error;
  }

  const picked = await credentials.pool.pick(connection);
  if (!picked.ok) return reply({ state: 'failed', cut: null, ...empty }, picked.failure);
  const serving = picked.account;
  account = serving;
  // A reply that failed leaves the account's meters to be read again before the next pick; it is never sent again on
  // another account: every try goes with the credential picked here.
  const failed = (failure: CredentialFailure | { kind: 'refused'; code: string }) => {
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
  const retry = retryOf(retries);
  if (batches) {
    const { cancel } = batching!;
    const asking: Asking = { route, model, batches, ask: (each) => withCredential(route, each, credential.credential), signal, cancel, onText, inline };
    // Not stopped midway: a batch the provider made with no marker naming it would answer, and be billed, unread.
    const submit = () => relayJson(asking.ask(batches.submit(route.endpoint, model, request, call.id)));
    let submitted = await submit();
    // Sent again only on the provider's own answer, which says no batch was made; a connection lost on the way may have
    // made one.
    for (tries = 1; !submitted.ok && retry && tries <= retry.times; tries++) {
      const { failure } = submitted;
      const wait = failure.kind === 'provider' && retry.statuses.includes(failure.status) ? retryWait(tries, failure.retryAfter ?? null, Date.now()) : null;
      if (wait === null) break;
      call.retrying?.();
      if (!(await pause(wait, AbortSignal.any([signal, cancel])))) return reply(...STOPPED);
      submitted = await submit();
    }
    if (!submitted.ok) return failed(submitted.failure);
    const batch = batches.submitted(submitted.data);
    if (batch === null) {
      credentials.pool.stale(connection, serving);
      return reply(...failedWith({ kind: 'bad-event', detail: JSON.stringify(submitted.data).slice(0, 200) }));
    }
    // A batch stopped as it was made gets no marker, as a stream's call gets none (runtime/relay stream); waitBatch cancels it.
    if (!cancel.aborted) {
      call.started?.(batch);
      batching!.waiting();
    }
    const [outcome, error] = await waitBatch(asking, batch, call.id);
    if (error) credentials.pool.stale(connection, serving);
    return reply(outcome, error);
  }
  const response = await stream(call, withCredential(route, request, credential.credential), signal, retry);
  tries = call.tries ?? null;
  if (!(response instanceof Response)) return failed(response.kind === 'provider' && laneBusy(route, asked, response.status, response.code ?? null) ? { kind: 'refused', code: 'discount-busy' } : response);
  const outcome = await decodeStream(route, model, response, signal, timed, inline);
  if (outcome.error) credentials.pool.stale(connection, serving);
  return reply(outcome, outcome.error);
}

type Answered = [Omit<Outcome, 'error'>, Reply['error']];
const EMPTY = { finishReason: null, usage: null, cost: null, replyId: null };
const STOPPED: Answered = [{ state: 'cut', cut: 'stopped', ...EMPTY }, null];
const failedWith = (error: NonNullable<Reply['error']>): Answered => [{ state: 'failed', cut: null, ...EMPTY }, error];

// ask: a request with the account's credential added. cancel: absent for a reader that cannot cancel the batch.
type Asking = { route: Route; model: Model; batches: Batches; ask: (request: HttpRequest) => HttpRequest; signal: AbortSignal; cancel?: AbortSignal; onText: GenerateInput['onText']; inline?: InlineThoughts };

// A batch is asked about through the relay, each ask a short call, so no server object holds it and a deploy cuts
// nothing. Soon at first, since a batch of one often ends within minutes, then once a minute.
const CHECKS_MS = [5_000, 10_000, 15_000, 30_000, 60_000];

// Failures worth waiting through: the page's own connection, and the provider busy or down for a moment.
const passing = (failure: Exclude<RelayFailure, { kind: 'stopped' }>) => failure.kind === 'offline' || failure.kind === 'relay' || (failure.kind === 'provider' && RETRYABLE.includes(failure.status));

// 멈추기 cancels the batch at the provider, and it is still asked about until it ends: an answer made before the cancel
// landed is billed all the same, so it is read and kept, and a canceled one ends as stopped. Once signal stops the wait,
// a cancel asked for meanwhile is sent and checked once; the batch is then left to its marker.
async function waitBatch(asking: Asking, batch: string, key: string): Promise<Answered> {
  const { route, batches, ask, signal, cancel } = asking;
  let canceled = false;
  for (let tries = 0; ; tries++) {
    if (!canceled && cancel?.aborted) {
      canceled = true;
      // Asked about soon again: a canceled batch ends within moments.
      tries = 0;
      await relay(ask(batches.cancel(route.endpoint, batch)));
    } else if (signal.aborted) return STOPPED;
    else if (!(await pause(CHECKS_MS[Math.min(tries, CHECKS_MS.length - 1)]!, canceled || !cancel ? signal : AbortSignal.any([signal, cancel])))) continue;
    const checked = await relayJson(ask(batches.check(route.endpoint, batch)), canceled ? undefined : signal);
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
      return failedWith({ kind: 'refused', code: 'batch-expired' });
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
// server's, or for a batch the time until this page read its answer. turn: a reply's reader (Talk), told of each try
// sent again (StreamCall retrying), and whose 멈추기 cancels a batch (GenerateInput batching).
export async function resume({ store, credentials }: { store: ObjectStore; credentials: Credentials }, { id, value }: Stored<'stream'>, signal: AbortSignal, onText: GenerateInput['onText'], inline?: InlineThoughts, turn?: { retrying: () => void; cancel: AbortSignal }): Promise<Reply> {
  let took = 0;
  let tries: number | null = null;
  let protocol = '';
  const reply = ([outcome, error]: Answered): Reply => {
    const refusal = error?.kind === 'provider' ? contextRefusal(protocol, error) : null;
    const calibration = completedCalibration(value.calibration, outcome);
    return { ...outcome, ...(refusal && { usage: null, cost: null }), call: id, account: null, tries, error, firstTextMs: null, totalMs: took, request: null, cache: null, calibration: refusal ? { ...calibration, eligible: false, refusal } : calibration, contextRefusal: refusal };
  };
  const route = routeOf(store, value.call);
  const resolved = 'kind' in route ? null : resolveConnection(route.connection.value);
  if ('kind' in route || !resolved) return reply(failedWith({ kind: 'refused', code: 'model-gone' }));
  const routed = resolveModel(resolved, route.model);
  protocol = routed.endpoint.protocol;
  if ('batch' in value) {
    const lane = routed.type?.discount;
    // A marker a newer version wrote, for a lane this one does not have.
    if (lane?.lane !== 'batch') return reply(failedWith({ kind: 'refused', code: 'unknown-connection-type' }));
    const credential = await credentials.get(resolved, route.connection.value.accounts[0]!.secret, signal);
    if (!credential.ok) return reply(credential.failure.kind === 'stopped' ? STOPPED : failedWith(credential.failure));
    const answered = await waitBatch({ route: routed, model: route.model, batches: lane.batches, ask: (each) => withCredential(routed, each, credential.credential), signal, cancel: turn?.cancel, onText, inline }, value.batch, id);
    took = Date.now() - value.at;
    return reply(answered);
  }
  const call: StreamCall = { id, key: value.key, retrying: turn?.retrying };
  const response = await stream(call, null, signal);
  took = call.took ?? 0;
  tries = call.tries ?? null;
  if (!(response instanceof Response)) return reply(response.kind === 'stopped' ? STOPPED : failedWith(response));
  const outcome = await decodeStream(routed, route.model, response, signal, onText, inline);
  took = call.took ?? 0;
  return reply([outcome, outcome.error]);
}
