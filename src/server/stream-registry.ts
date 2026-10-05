import type { Upstream } from './relay';
import { StreamBox } from './stream-box';
import type { StreamStore } from './db/streams-db';

// The reply streams of this process: at most one StreamBox per name, kept while its call runs or a reader reads it. A
// name with no box is read from its stored pages; after a restart that is every name, and its reply ends as lost.
export type Streams = {
  start(name: string, body: { id: string; key: unknown; request: unknown }): Promise<Response>;
  read(name: string, from: number): Promise<Response>;
  stop(name: string): void;
  // The call ends, its readers end, then its rows go.
  drop(name: string): Promise<void>;
  live(): number;
  // Settles once no call runs.
  settled(): Promise<void>;
  // Drops every stream whose alarm is at or before now.
  expire(now: number): Promise<void>;
  close(): void;
};

export function streamRegistry(store: StreamStore, upstream: Upstream): Streams {
  const boxes = new Map<string, StreamBox>();
  const box = (name: string) => {
    const found = boxes.get(name);
    if (found) return found;
    const made: StreamBox = new StreamBox(store.storage(name), upstream, () => {
      if (boxes.get(name) === made) boxes.delete(name);
    });
    boxes.set(name, made);
    return made;
  };
  const running = () => [...boxes.values()].filter((each) => each.running);
  const drop = async (name: string) => {
    const found = boxes.get(name);
    boxes.delete(name);
    await found?.drop();
    store.remove(name);
  };
  return {
    start: (name, body) => box(name).start(body),
    read: (name, from) => box(name).read(from),
    stop: (name) => boxes.get(name)?.stop(),
    drop,
    live: () => running().length,
    settled: async () => {
      for (let calls = running(); calls.length; calls = running()) await Promise.all(calls.map((each) => each.ended));
    },
    expire: async (now) => {
      for (const name of store.due(now)) await drop(name);
    },
    close: () => store.close(),
  };
}
