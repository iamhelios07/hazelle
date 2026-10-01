import { afterEach, expect, it, vi } from 'vitest';
import { randomBytes } from '../vault/aead';
import { openSession } from './session';
import type { PullProgress } from './store';

afterEach(() => vi.unstubAllGlobals());

it('reports received objects and pages during opening and aborts the in-flight initial pull without starting a session', async () => {
  const abandon = new AbortController();
  const progress: PullProgress[] = [];
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.signal).toBe(abandon.signal);
    url = url.replace(/&account=account&known=\d+$/, '');
    if (url === '/api/objects?since=3&exclude=entry,memory&bootstrap=1') {
      started();
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    const revs = url === '/api/objects?since=0&exclude=entry,memory&bootstrap=1' ? [1, 2] : [3];
    return Response.json({
      changes: revs.map((rev) => ({ id: `gone-${rev}`, kind: 'connection', parent: null, rev, body: null })),
      cursor: revs.at(-1),
      more: true,
      limits: { items: 100, bytes: 1_000_000, body: 100_000 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const opening = openSession('account', randomBytes(32), 'jin', abandon.signal, (next) => progress.push(next));
  await waiting;
  expect(progress).toEqual([{ objects: 2, pages: 1 }, { objects: 3, pages: 2 }]);
  abandon.abort();
  expect(await opening).toEqual({ ok: false, error: 'stopped' });
  expect(fetch.mock.calls.map(([url]) => url.replace(/&account=account&known=\d+$/, ''))).toEqual(['/api/objects?since=0&exclude=entry,memory&bootstrap=1', '/api/objects?since=2&exclude=entry,memory&bootstrap=1', '/api/objects?since=3&exclude=entry,memory&bootstrap=1']);
});
