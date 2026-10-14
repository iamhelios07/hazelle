import { discounted, priceCost } from './pricing';
import { costUnit, type Route } from './registry';
import { SseParser } from './sse';
import { thoughts } from './thoughts';
import type { Codec, Cost, Discount, Model, Phase, StreamFacts, Terminal, Usage } from './types';

// A cut or failed reply is never shown as a clean success.
export type Outcome = {
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | null;
  error: { kind: 'provider' | 'bad-event' | 'network'; detail: string; code?: string } | null;
  inputComplete?: true;
  finishReason: string | null;
  usage: Usage | null;
  // pending: the type books the cost after the reply, to be looked up by replyId. A pending lookup goes ahead of the
  // model's price: put after it, a priced model would never be looked up, and the booked cost is the true one.
  cost: Cost | 'pending' | null;
  replyId: string | null;
  // The discount lane that served it (model/chat Receipt discount); absent when none did.
  discount?: Discount['lane'];
};

// keep: left where they are, for a reply of a character set to 추론을 본문에 표시; a translation always strips them (user
// ruling, 2026-10-04). takeBack: only a reader that keeps the reasoning acts on it (Talk); translate, memory and
// scripts keep the text only, and get what is given back as text all the same.
export type InlineThoughts = { keep?: boolean; takeBack?: (chars: number) => void };

// The reply in the format the provider answered with: an event stream, or one JSON document when it was asked for
// whole (ModelSettings streaming). Both read into the same facts and end through the same rules. batched: the reply is
// the answer read from a discount lane's batch (Batches answer).
export async function decodeStream({ type, codec }: Route, model: Model, response: Response, signal: AbortSignal, onText: (phase: Phase, text: string) => void, inline: InlineThoughts = {}, batched = false): Promise<Outcome> {
  const facts: StreamFacts = { rawUsage: {}, finishReason: null, id: null, tier: null };
  const scanner = inline.keep ? null : thoughts(onText, inline.takeBack ?? (() => {}));
  const append = (phase: Phase, text: string) => text && (scanner ? scanner.push(phase, text) : onText(phase, text));

  const unit = costUnit(type);
  const finish = (state: Outcome['state'], cut: Outcome['cut'], error: Outcome['error']): Outcome => {
    scanner?.end(state === 'done');
    const usage = Object.keys(facts.rawUsage).length ? codec.usage(facts.rawUsage) : null;
    // Priced by what the provider reports, never by the switch: a reply the lane did not serve costs the standard rate.
    const lane = type?.discount;
    const served = lane && (lane.lane === 'batch' ? batched : facts.tier === lane.served) ? lane : null;
    const price = model.price && (served ? discounted(model.price, served.rates) : model.price);
    return {
      state,
      cut,
      error,
      finishReason: facts.finishReason,
      usage,
      cost: type?.cost?.({ facts, usage, model }) ?? (type?.settle && facts.id ? 'pending' : null) ?? (price ? priceCost(price, usage, unit) : null),
      replyId: facts.id,
      ...(served && { discount: served.lane }),
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
  if (terminal?.state === 'failed') return finish('failed', null, { kind: 'provider', detail: terminal.error, ...(terminal.code && { code: terminal.code }) });
  // A stream may close without its end marker after the model already said why it stopped.
  if (!terminal && facts.finishReason === null) return finish('cut', 'no-terminal', null);
  const outcome = facts.finishReason !== null && codec.truncated(facts.finishReason) ? finish('cut', 'length', null) : finish('done', null, null);
  // A finish reason without the codec's terminal is not authoritative input evidence.
  return terminal?.state === 'completed' ? { ...outcome, inputComplete: true } : outcome;
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
