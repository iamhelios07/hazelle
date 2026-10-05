import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, expect, it } from 'vitest';
import { streamStore } from './streams-db';

const dir = mkdtempSync(join(tmpdir(), 'hazelle-streams-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('reserves a name once, with its hello and its alarm', async () => {
  const store = streamStore(':memory:');
  const storage = store.storage('a');
  const hello = { key: 'f:0000000000', value: new Uint8Array([1, 2]) };
  expect(await storage.reserve(hello, 5)).toBe(true);
  expect(await store.storage('a').reserve(hello, 6)).toBe(false);
  expect(await storage.get('f:0000000000')).toEqual(new Uint8Array([1, 2]));
  expect(store.due(5)).toEqual(['a']);
  store.close();
});

it('refuses a file of a newer version than this build knows', () => {
  const path = join(dir, 'newer.sqlite');
  streamStore(path).close();
  const raw = new DatabaseSync(path);
  raw.exec('UPDATE meta SET version = version + 1');
  raw.close();
  expect(() => streamStore(path)).toThrow(/at version 2/);
});
