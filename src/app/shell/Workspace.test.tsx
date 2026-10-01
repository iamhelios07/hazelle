import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { randomBytes } from '../../vault/aead';
import { Workspace } from './Workspace';

it('shows the initial pull count before the session opens instead of a blank screen', () => {
  const html = renderToStaticMarkup(<Workspace accountId="account" vaultKey={randomBytes(32)} username="jin" onLock={() => {}} onLogout={async () => null} />);
  expect(html).toContain('불러오는 중 · 0개');
});
