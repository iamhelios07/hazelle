import { expect, it } from 'vitest';
import { releases } from './releases';

it('offers the newest GitHub release only when it is newer than the one running, and keeps it through a failed check', async () => {
  let answer: () => Response = () => Response.json({ tag_name: 'v0.10.0' });
  const asked: Headers[] = [];
  const outbound = async (_url: URL, init: { headers: Headers }) => (asked.push(init.headers), answer());
  const running = releases(outbound as never, 'v0.9.3');
  expect(running.newer()).toBeNull();
  await running.refresh();
  expect(running.newer()).toBe('v0.10.0');
  expect(asked[0]!.get('user-agent')).toBeTruthy();
  answer = () => new Response('rate limited', { status: 403 });
  await running.refresh();
  expect(running.newer()).toBe('v0.10.0');

  const newest = releases(outbound as never, 'v0.10.0');
  answer = () => Response.json({ tag_name: 'v0.10.0' });
  await newest.refresh();
  expect(newest.newer()).toBeNull();
  const unversioned = releases(outbound as never, null);
  await unversioned.refresh();
  expect(unversioned.newer()).toBeNull();
});
