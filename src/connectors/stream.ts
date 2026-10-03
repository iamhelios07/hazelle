import type { Resolved } from './registry';
import { SseParser } from './sse';
import { thoughts } from './thoughts';
import type { Codec, Cost, Model, Phase, StreamFacts, Terminal, Usage } from './types';

// A cut or failed reply is never shown as a clean success.
export type Outcome = {
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | null;
  error: { kind: 'provider' | 'bad-event' | 'network'; detail: string } | null;
  finishReason: string | null;
  usage: Usage | null;
  // pending: the type books the cost after the reply, to be looked up by replyId.
  cost: Cost | 'pending' | null;
  replyId: string | null;
};

// What becomes of the thinking blocks an answer writes inside its text (connectors/thoughts). keep: left where they are,
// for a reply of a character set to 생각을 본문에 둠; a translation always strips them (user ruling, 2026-10-04).
// takeBack: only a reader that keeps the reasoning acts on it (Talk); translate, memory and scripts keep the text only,
// and get what is given back as text all the same.
export type InlineThoughts = { keep?: boolean; takeBack?: (chars: number) => void };

// The reply in the format the provider answered with: an event stream, or one JSON document when it was asked for
// whole (ModelSettings streaming). Both read into the same facts and end through the same rules.
export async function decodeStream({ type, codec }: Resolved, model: Model, response: Response, signal: AbortSignal, onText: (phase: Phase, text: string) => void, inline: InlineThoughts = {}): Promise<Outcome> {
  const facts: StreamFacts = { rawUsage: {}, finishReason: null, id: null };
  const scanner = inline.keep ? null : thoughts(onText, inline.takeBack ?? (() => {}));
  const append = (phase: Phase, text: string) => text && (scanner ? scanner.push(phase, text) : onText(phase, text));

  const finish = (state: Outcome['state'], cut: Outcome['cut'], error: Outcome['error']): Outcome => {
    scanner?.end(state === 'done');
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

  const media = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  let ended: { terminal: Terminal | null } | { badEvent: string };
  try {
    ended = media === 'application/json' ? await readWhole(codec, response, facts, append) : await readEvents(codec, response, facts, append);
  } catch (error) {
    if (signal.aborted) return finish('cut', 'stopped', null);
    return finish('failed', null, { kind: 'network', detail: error instanceof Error ? error.message : String(error) });
  }

  if ('badEvent' in ended) return finish('failed', null, { kind: 'bad-event', detail: ended.badEvent });
  const { terminal } = ended;
  if (terminal?.state === 'failed') return finish('failed', null, { kind: 'provider', detail: terminal.error });
  // A stream may close without its end marker after the model already said why it stopped.
  if (!terminal && facts.finishReason === null) return finish('cut', 'no-terminal', null);
  if (facts.finishReason !== null && codec.truncated(facts.finishReason)) return finish('cut', 'length', null);
  return finish('done', null, null);
}

type Append = (phase: Phase, text: string) => void;

async function readWhole(codec: Codec, response: Response, facts: StreamFacts, append: Append) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { badEvent: text.slice(0, 200) };
  }
  const terminal = codec.whole(payload, facts, append);
  return terminal ? { terminal } : { badEvent: text.slice(0, 200) };
}

// A 204 carries no body: the same as a stream that closed before anything came.
async function readEvents(codec: Codec, response: Response, facts: StreamFacts, append: Append) {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body?.getReader();
  let terminal: Terminal | null = null;
  try {
    while (reader && !terminal) {
      const { done, value } = await reader.read();
      const events = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
      for (const data of events) {
        let event: unknown;
        try {
          event = data === '[DONE]' ? data : JSON.parse(data);
        } catch {
          return { badEvent: data.slice(0, 200) };
        }
        codec.read(event, facts, append);
        terminal = codec.terminal(event);
        if (terminal) break;
      }
      if (done) break;
    }
  } finally {
    // Ends the upstream call once a terminal event arrived early; harmless after the stream's own end.
    void reader?.cancel().catch(() => {});
  }
  return { terminal };
}
