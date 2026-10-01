import { cacheNewer, cacheScope, type CacheState, type CacheWrite, type DeviceCache, type SealedChange } from '../object-cache';

export class MemoryCache implements DeviceCache {
  readonly rows = new Map<string, SealedChange>();
  readonly states = new Map<string, CacheState>();

  async read(chat = '') {
    const state = this.states.get(chat);
    return state ? structuredClone({ state, changes: [...this.rows.values()].filter((row) => cacheScope(row) === chat) }) : null;
  }

  async write(write: CacheWrite) {
    const { changes, feed, scopes } = structuredClone(write);
    for (const row of changes) if (cacheNewer(this.rows.get(row.id), row)) this.rows.set(row.id, row);
    this.states.set('', feed);
    for (const scope of scopes ?? []) this.states.set(scope.chat, scope.state);
  }

  async clear() {
    this.rows.clear();
    this.states.clear();
  }
}
