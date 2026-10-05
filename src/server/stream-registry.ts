import type { Upstream } from './relay';
import { StreamBox, type BoxStorage, type Live } from './stream-box';

// ReplyStream's namespace in process: one StreamBox per name over a map. Replaced by a SQLite page store later; until
// then a restart loses every reply in flight.

export type Streams = { box(name: string): Pick<StreamBox, 'handle'>; live(): number };

function memory(): Omit<BoxStorage, 'setAlarm'> {
  const held = new Map<string, unknown>();
  return {
    get: async (key) => held.get(key),
    put: async (key, value) => void held.set(key, value),
    list: async ({ start, end, limit }) =>
      new Map([...held].filter(([key]) => key >= start && key < end).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit)),
    deleteAll: async () => held.clear(),
  };
}

export function streamRegistry(upstream: Upstream): Streams {
  const boxes = new Map<string, StreamBox>();
  let calls = 0;
  const create = (name: string) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Per box, so a box that ends twice (its drop, then its alarm) cannot end another box's call.
    let calling = false;
    const live: Live = {
      began: () => {
        calling = true;
        calls++;
      },
      ended: async () => {
        if (calling) calls--;
        calling = false;
      },
    };
    const box: StreamBox = new StreamBox(
      {
        ...memory(),
        setAlarm: async (at) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            boxes.delete(name);
            void box.expire();
          }, at - Date.now());
          timer.unref();
        },
      },
      upstream,
      live,
    );
    boxes.set(name, box);
    return box;
  };
  return {
    box: (name) => boxes.get(name) ?? create(name),
    live: () => calls,
  };
}
