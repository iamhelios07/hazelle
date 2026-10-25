import { expect, it } from 'vitest';
import { inlayIds, pictured, pictureLead } from './assets';

it("leads a message with its attached pictures' tags, which the translation takes off and puts back", () => {
  const sent = pictured(['a', 'b'], '이거 봐.');
  expect(inlayIds([sent])).toEqual(['a', 'b']);
  const { lead, text } = pictureLead(sent);
  expect([lead + 'Look at this.', text]).toEqual([pictured(['a', 'b'], 'Look at this.'), '이거 봐.']);
  expect(pictureLead(pictured(['a'], ''))).toEqual({ lead: '{{inlay::a}}', text: '' });
  expect(pictureLead('{{inlay::a}} 글 사이')).toEqual({ lead: '', text: '{{inlay::a}} 글 사이' });
});
