import { expect, test } from 'vitest';
import { messageRow } from './SentSection';

test('a message row leads with its first line and previews the rest', () => {
  expect(messageRow('헤이젤 나우를 열었어요!\n\n- 공개 페이지예요.\n- 기본으로 켜져 있어요.')).toEqual({ title: '헤이젤 나우를 열었어요!', description: '- 공개 페이지예요.\n- 기본으로 켜져 있어요.' });
  expect(messageRow('한 줄 알림')).toEqual({ title: '한 줄 알림' });
});
