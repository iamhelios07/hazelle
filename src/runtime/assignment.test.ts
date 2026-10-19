import { expect, it } from 'vitest';
import { callRef } from '../model/chat';
import type { Stored } from '../model/kinds';
import { routeOf } from './assignment';
import { testConnection, testModel } from './testing';

it("routes a call made through a copy to that copy, and one made through the first entry to it", () => {
  const copy = { ...testModel, entry: '#low', label: 'M (low)' };
  const connection: Stored<'connection'> = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { ...testConnection, starred: [testModel, copy] } };
  const store = { get: ((kind: string, id: string) => (kind === 'connection' && id === 'c' ? connection : undefined)) as never };
  expect(routeOf(store, callRef({ connection: 'c', model: testModel.id, entry: '#low' }))).toEqual({ connection, model: copy });
  expect(routeOf(store, callRef({ connection: 'c', model: testModel.id }))).toEqual({ connection, model: testModel });
});
