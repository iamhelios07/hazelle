import { live } from '../model/library';
import type { Stored } from '../model/kinds';
import { memoryId } from '../model/memory';
import type { Stream } from '../model/stream';
import { streamKey } from '../vault/streams';
import type { Route } from './assignment';
import { dropStream, type StreamCall } from './relay';
import type { ObjectStore } from './store';

// The only writer of `stream` objects, each the marker of a generation call the server is making for a chat
// (tech-spec §6, Detached replies).

export const callOf = (route: Route): Stream['call'] => ({ connection: route.connection.id, source: route.connection.value.label, model: route.model.id, modelName: route.model.name });

// chat: null for a chat not saved yet, whose call a reload does not pick up.
export type CallTarget = { id: string; chat: string | null; result: string; for: Stream['for'] };

// Its marker is written once the server holds the call, never before: a pick-up that found the marker of a call not
// started yet would read no call and save that as its result. A marker that fails to save only leaves the call to this
// page; one that lands after its result was saved is removed by the next pick-up.
export async function newCall(store: ObjectStore, route: Route, { id, chat, result, for: purpose }: CallTarget): Promise<StreamCall> {
  const key = await streamKey();
  const at = Date.now();
  const started = chat === null ? undefined : () => void store.create('stream', { key: key.private, call: callOf(route), at, result, for: purpose }, { id, parent: chat });
  return { id, key: key.private, public: key.public, started };
}

// A call no marker keeps, which only this page reads: a bot's Lua asking a model in the middle of a run, which a
// reload has no use for. The server limits these per chat.
export async function botCall(chat: string): Promise<StreamCall> {
  const key = await streamKey();
  return { id: crypto.randomUUID(), key: key.private, public: key.public, bot: chat };
}

export function endCall(store: ObjectStore, id: string) {
  dropStream(id);
  if (store.get('stream', id)) void store.remove(id);
}

// Picks up the calls this page is not reading (reading, which Talk, Translator and Rememberer keep): when the session
// opens and whenever a marker or an entry changes, which is also when a reply waiting for its chat's turn in Talk to end can go.
export class Streams {
  private closed = false;
  private readonly checking = new Set<string>();
  private readonly stop: () => void;

  constructor(
    private readonly store: ObjectStore,
    readonly reading: Set<string>,
    private readonly take: (stream: Stored<'stream'>) => void,
  ) {
    this.stop = store.subscribe((changes) => {
      if (changes.some((change) => change.kind === 'stream' || change.kind === 'entry')) this.pickUp();
    });
  }

  pickUp() {
    if (this.closed) return;
    for (const stream of this.store.list('stream')) {
      // A deleted chat's calls stay untaken: they go with its purge, or after its 되돌리기 the next pick-up takes them.
      if (this.reading.has(stream.id) || this.checking.has(stream.id) || !live(this.store.get('chat', stream.parent!))) continue;
      this.checking.add(stream.id);
      void this.store.withChat(stream.parent!, async () => {
        if (!this.closed && !this.reading.has(stream.id)) {
          if (this.saved(stream)) endCall(this.store, stream.id);
          else this.take(stream);
        }
        return { ok: true, data: null };
      }).finally(() => this.checking.delete(stream.id));
    }
  }

  close() {
    this.closed = true;
    this.stop();
  }

  // A memory summary's result is not an entry: its first record, or its chapter, takes the result's id.
  private saved({ parent, value: { result, for: purpose } }: Stored<'stream'>): boolean {
    if (purpose.kind !== 'memory') return this.store.children('entry', parent!).some((entry) => entry.id === result);
    const memory = this.store.children('memory', parent!).find((each) => each.id === memoryId(parent!))?.value;
    return memory !== undefined && [...memory.records, ...memory.chapters].some(({ id }) => id === result);
  }
}
