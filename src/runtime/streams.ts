import type { Stored } from '../model/kinds';
import type { Stream } from '../model/stream';
import { streamKey } from '../vault/streams';
import type { Route } from './assignment';
import { dropStream, type StreamCall } from './relay';
import type { ObjectStore } from './store';

// The only writer of `stream` objects, each the marker of a generation call the server is making for a chat
// (tech-spec §6, Detached replies).

export const callOf = (route: Route): Stream['call'] => ({ connection: route.connection.id, source: route.connection.value.label, model: route.model.id, modelName: route.model.name });

// What a new call is for: its id, the saved chat that keeps its marker (null for a chat not saved yet, whose call a
// reload does not pick up), the id its result is saved under, and what that result is.
export type CallTarget = { id: string; chat: string | null; result: string; for: Stream['for'] };

// A new call's keys, its marker written while the call starts. A marker that fails to save only leaves the call to
// this page; one that lands after its result was saved is removed by the next pick-up.
export async function newCall(store: ObjectStore, route: Route, { id, chat, result, for: purpose }: CallTarget): Promise<StreamCall> {
  const key = await streamKey();
  if (chat !== null) void store.create('stream', { key: key.private, call: callOf(route), at: Date.now(), result, for: purpose }, { id, parent: chat });
  return { id, key: key.private, public: key.public };
}

// Once the call's result is saved, here or by another device.
export function endCall(store: ObjectStore, id: string) {
  dropStream(id);
  if (store.get('stream', id)) void store.remove(id);
}

// Picks up the calls this page is not reading (reading, which Talk and Translator keep): when the session opens and
// whenever a marker or an entry changes, which is also when a reply waiting for Talk to be free can go.
export class Streams {
  private closed = false;
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
      if (this.reading.has(stream.id)) continue;
      if (this.store.get('entry', stream.value.result)) endCall(this.store, stream.id);
      else this.take(stream);
    }
  }

  close() {
    this.closed = true;
    this.stop();
  }
}
