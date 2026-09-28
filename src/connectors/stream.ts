import type { Resolved } from './registry';
import { SseParser } from './sse';
import type { Cost, Model, Phase, StreamFacts, Terminal, Usage } from './types';

// design F3: a reply is done, cut or failed, and a cut or failed reply is never shown as a clean success.
// cut says why: the token limit, a stream that ended without its end marker, or the user's 멈추기.
// A failure says whose it was: the provider's own message, an event that was not JSON, or the connection.
export type Outcome = {
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | null;
  error: { kind: 'provider' | 'bad-event' | 'network'; detail: string } | null;
  finishReason: string | null;
  usage: Usage | null;
  // pending: the type books the cost after the reply, to be looked up by replyId (runtime settleCost).
  cost: Cost | 'pending' | null;
  replyId: string | null;
};

export async function decodeStream(
  { type, codec }: Resolved,
  model: Model,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onText: (phase: Phase, text: string) => void,
): Promise<Outcome> {
  const facts: StreamFacts = { rawUsage: {}, finishReason: null, id: null };
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let terminal: Terminal | null = null;
  let badEvent: string | null = null;

  const handle = (data: string) => {
    let event: unknown;
    try {
      event = data === '[DONE]' ? data : JSON.parse(data);
    } catch {
      badEvent = data.slice(0, 200);
      return;
    }
    codec.read(event, facts, (phase, text) => text && onText(phase, text));
    terminal = codec.terminal(event);
  };

  const finish = (state: Outcome['state'], cut: Outcome['cut'], error: Outcome['error']): Outcome => {
    const usage = Object.keys(facts.rawUsage).length ? codec.usage(facts.rawUsage) : null;
    return {
      state,
      cut,
      error,
      finishReason: facts.finishReason,
      usage,
      cost: type?.cost?.({ facts, usage, model }) ?? (type?.settle && facts.id ? 'pending' : null),
      replyId: facts.id,
    };
  };

  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      const events = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
      for (const data of events) {
        handle(data);
        if (terminal || badEvent !== null) break;
      }
      if (done || badEvent !== null) break;
    }
  } catch (error) {
    if (signal.aborted) return finish('cut', 'stopped', null);
    return finish('failed', null, { kind: 'network', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    // Ends the upstream call once a terminal event arrived early; harmless after the stream's own end.
    void reader.cancel().catch(() => {});
  }

  if (badEvent !== null) return finish('failed', null, { kind: 'bad-event', detail: badEvent });
  const ended = terminal as Terminal | null;
  if (ended?.state === 'failed') return finish('failed', null, { kind: 'provider', detail: ended.error });
  // A stream may close without its end marker after the model already said why it stopped.
  if (!ended && facts.finishReason === null) return finish('cut', 'no-terminal', null);
  if (facts.finishReason !== null && codec.truncated(facts.finishReason)) return finish('cut', 'length', null);
  return finish('done', null, null);
}
