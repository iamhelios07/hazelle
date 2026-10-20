import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { NameDialog } from './NameDialog';

it('refuses a blank name and says one is needed, unless a blank is a value there', () => {
  const shown = (blank: boolean) => renderToStaticMarkup(<NameDialog title="새 폴더" value="  " blank={blank} onSave={() => {}} onClose={() => {}} />);
  expect(shown(false)).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  expect(shown(false)).toContain('이름을 입력해 주세요.');
  expect(shown(true)).not.toContain('disabled');
});
