import { chatRequest, resolveConnection, resolveModel, withCredential, type Resolved } from '../connectors/registry';
import { decodeStream, type Outcome } from '../connectors/stream';
import type { ModelSettings } from '../connectors/settings';
import { ConnectorError, type ChatMessage, type Connection, type HttpRequest, type Phase, type Starred } from '../connectors/types';
import type { CredentialFailure, Credentials } from './credential';
import { relay } from './relay';

export type ReplyError =
  | { kind: 'refused'; code: string }
  | CredentialFailure
  | NonNullable<Outcome['error']>;

// The facts a receipt keeps: the outcome, and times measured from the moment of sending.
// A stop is a cut, never an error. request is the address and body the request was built with, for 요청 원문;
// null when it was refused before it could be built.
export type Reply = Omit<Outcome, 'error'> & {
  error: Exclude<ReplyError, { kind: 'stopped' }> | null;
  firstTextMs: number | null;
  totalMs: number;
  request: Pick<HttpRequest, 'url' | 'body'> | null;
};

export type GenerateInput = {
  credentials: Credentials;
  connection: Connection;
  model: Starred;
  settings: ModelSettings;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (phase: Phase, text: string) => void;
};

export async function generate({ credentials, connection, model, settings, messages, signal, onText }: GenerateInput): Promise<Reply> {
  const started = performance.now();
  let firstText: number | null = null;
  // Never the headers: the credential travels there, and leaving them out is the redaction that cannot leak.
  let built: Reply['request'] = null;
  const reply = (outcome: Omit<Outcome, 'error'>, error: Reply['error']): Reply => ({
    ...outcome,
    error,
    firstTextMs: firstText === null ? null : Math.round(firstText - started),
    totalMs: Math.round(performance.now() - started),
    request: built,
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
  } catch (error) {
    if (error instanceof ConnectorError) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: error.code });
    throw error;
  }

  const failed = (failure: CredentialFailure) =>
    failure.kind === 'stopped' ? reply({ state: 'cut', cut: 'stopped', ...empty }, null) : reply({ state: 'failed', cut: null, ...empty }, failure);
  const credential = await credentials.get(resolved, connection.secret, signal);
  if (!credential.ok) return failed(credential.failure);
  const response = await relay(withCredential(route, request, credential.credential), signal);
  if (!(response instanceof Response)) return failed(response);
  // A 204 carries no body: the same as a stream that closed before anything came.
  const body = response.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
  const outcome = await decodeStream(route, model, body, signal, (phase, text) => {
    firstText ??= performance.now();
    onText(phase, text);
  });
  return reply(outcome, outcome.error);
}
