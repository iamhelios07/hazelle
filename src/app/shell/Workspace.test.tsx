import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AccountFacts } from '../../runtime/account';
import { randomBytes } from '../../vault/aead';
import { Workspace } from './Workspace';

it('shows the initial pull count before the session opens instead of a blank screen', () => {
  const html = renderToStaticMarkup(<Workspace accountId="account" vaultKey={randomBytes(32)} username="jin" admin={false} unreadNotices={0} facts={new AccountFacts({ accountId: 'account', username: 'jin', admin: false, suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0 })} onLock={() => {}} onLogout={async () => null} />);
  expect(html).toContain('불러오는 중 · 0개');
});
