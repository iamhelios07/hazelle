import { chatRequest, resolveConnection } from '../connectors/registry';
import { decodeStream, type Outcome } from '../connectors/stream';
import { ConnectorError, type ChatMessage, type Connection, type HttpRequest, type Model, type Phase } from '../connectors/types';
import { relay, type RelayFailure } from './relay';

export type ReplyError =
  | { kind: 'refused'; code: string }
  | RelayFailure
  | NonNullable<Outcome['error']>;

// The facts a receipt keeps (tech-spec §5): the outcome, and times measured from the moment of sending.
export type Reply = Omit<Outcome, 'error'> & {
  error: ReplyError | null;
  firstTextMs: number | null;
  totalMs: number;
};

export type GenerateInput = {
  connection: Connection;
  model: Model;
  messages: ChatMessage[];
  maxTokens: number | null;
  signal: AbortSignal;
  onText: (phase: Phase, text: string) => void;
};

export async function generate({ connection, model, messages, maxTokens, signal, onText }: GenerateInput): Promise<Reply> {
  const started = performance.now();
  let firstText: number | null = null;
  const reply = (outcome: Omit<Outcome, 'error'>, error: ReplyError | null): Reply => ({
    ...outcome,
    error,
    firstTextMs: firstText === null ? null : Math.round(firstText - started),
    totalMs: Math.round(performance.now() - started),
  });
  const empty = { finishReason: null, usage: null, cost: null };

  // Refusals the connector can see coming are made here, before anything is sent (design §4).
  const resolved = resolveConnection(connection);
  if (!resolved) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: 'unknown-connection-type' });
  let request: HttpRequest;
  try {
    request = chatRequest(resolved, connection.secret, { model, messages, maxTokens });
  } catch (error) {
    if (error instanceof ConnectorError) return reply({ state: 'failed', cut: null, ...empty }, { kind: 'refused', code: error.code });
    throw error;
  }

  const response = await relay(request, signal);
  if (!(response instanceof Response)) {
    if (response.kind === 'stopped') return reply({ state: 'cut', cut: 'stopped', ...empty }, null);
    return reply({ state: 'failed', cut: null, ...empty }, response);
  }
  const outcome = await decodeStream(resolved, response.body!, signal, (phase, text) => {
    firstText ??= performance.now();
    onText(phase, text);
  });
  return reply(outcome, outcome.error);
}
