import { describe, expect, it } from 'vitest';
import { nodeStores } from './store-db-node';

const INC = 'a'.repeat(32);
const A = '11111111-1111-4111-8111-111111111111';

describe('account store', () => {
  it('writes and feeds one object', async () => {
    const stores = nodeStores({ life: async () => ({ state: 'active', timeline: 't1', operation: null }), phase: async () => null }, () => 0);
    const store = stores.getByName(INC);
    expect(await store.batch(INC, 't1', [{ id: A, kind: 'chat', parent: null, body: 'x', baseRev: null, file: null }], null)).toEqual({ revs: [1], bytes: 1, timeline: 't1' });
    expect(await store.feed(INC, { timeline: null, since: 0, known: 0, until: null, bootstrap: true, metadata: false, excluded: [], parent: null })).toEqual({
      timeline: 't1', bytes: 1, until: 1, changes: [{ id: A, kind: 'chat', parent: null, rev: 1, body: 'x' }], cursor: 1, more: false,
    });
  });
});
