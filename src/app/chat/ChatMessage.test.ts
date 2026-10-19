import { expect, it } from 'vitest';
import { inlayBlock, inlayMissing } from '../../engine/assets';
import { shownHtml } from './ChatMessage';

it("shows the chat's inlays without the bot's style, a found one as a picture block and a missing one as the mark, and nothing else of the bot's", () => {
  const id = '0b6f0a52-3c1e-4a8e-9d55-2f1c7b9e6a10';
  const asset = '5d0c2e1a-7b3f-4c9d-8e21-6a4b3c2d1e0f';
  const text = `보세요\n${inlayBlock(id)}\n${inlayMissing} <img src="asset:${asset}">`;
  expect(shownHtml(text, { bot: false, url: (kind, ref) => `blob:${kind}-${ref}` })).toBe(
    `<p>보세요</p>\n<div class="risu-inlay-image"><img src="blob:inlay-${id}"/></div><p>${inlayMissing} &lt;img src=<mark risu-mark="quote2">&quot;&quot;</mark>&gt;</p>\n`,
  );
});
