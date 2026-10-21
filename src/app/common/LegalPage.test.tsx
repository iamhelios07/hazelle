import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { legalPage } from './LegalPage';

it('shows the terms and the privacy page at their paths with no account, and nothing at any other path', () => {
  expect(renderToStaticMarkup(legalPage('/terms'))).toContain('만 19세 이상만 이용할 수 있습니다.');
  expect(renderToStaticMarkup(legalPage('/privacy'))).toContain('개인정보 보호책임자');
  expect(legalPage('/')).toBeNull();
});
