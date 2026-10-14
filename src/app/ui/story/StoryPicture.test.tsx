import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { VeilContext } from '../foundation/veil';
import { StoryPicture } from './StoryPicture';

it('puts 가리기 on a picture tapped open only while the veil is on', () => {
  const picture = <StoryPicture src="blob:x" label="삽화" width={2} height={3} />;
  const veiled = renderToStaticMarkup(<VeilContext.Provider value={{ revealed: new Set(['blob:x']) }}>{picture}</VeilContext.Provider>);
  expect(veiled).toContain('src="blob:x"');
  expect(veiled).toContain('aria-label="이미지 가리기">가리기</button>');
  const shown = renderToStaticMarkup(picture);
  expect(shown).toContain('src="blob:x"');
  expect(shown).not.toContain('가리기');
});
