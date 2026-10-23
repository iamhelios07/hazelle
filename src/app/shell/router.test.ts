import { afterEach, expect, it, vi } from 'vitest';
import { HOSTED } from '../../contracts/installation';
import { markSelfHost } from '../../runtime/installation';
import { navigate } from './router';

afterEach(() => {
  markSelfHost(false);
  vi.unstubAllGlobals();
});

it("opens every way into a self-host's 게시판 on hazelle.app and leaves the page where it is", () => {
  const open = vi.fn();
  const pushState = vi.fn();
  vi.stubGlobal('window', { open });
  vi.stubGlobal('history', { pushState });
  vi.stubGlobal('location', { pathname: '/', search: '' });
  markSelfHost(true);
  navigate({ kind: 'board', operator: false, category: 'news' });
  navigate({ kind: 'post', id: 7 });
  expect(open.mock.calls).toEqual([[`${HOSTED}/board?category=news`, '_blank', 'noopener'], [`${HOSTED}/board/7`, '_blank', 'noopener']]);
  expect(pushState).not.toHaveBeenCalled();
});
