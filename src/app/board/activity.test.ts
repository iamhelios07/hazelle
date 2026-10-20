import { expect, it } from 'vitest';
import type { Activity } from '../../contracts/board';
import { activityLine } from './activity';

const base: Activity = { id: 1, kind: 'comment', postId: 2, title: '제목', by: { name: '하늘', operator: false, mine: false, left: false }, at: 0, commentId: 3, status: null };

it('says who answered what one wrote, and what one’s post became, with the particle its status takes', () => {
  expect(activityLine(base)).toBe('하늘님이 내 글에 댓글을 남겼어요');
  expect(activityLine({ ...base, kind: 'reply', by: { name: null, operator: false, mine: false, left: true } })).toBe('탈퇴한 사용자님이 내 댓글에 답글을 남겼어요');
  expect(activityLine({ ...base, kind: 'status', by: { name: '운영자', operator: true, mine: false, left: false }, status: 'done' })).toBe('내 글이 완료로 바뀌었어요');
  expect(activityLine({ ...base, kind: 'status', status: 'seen' })).toBe('내 글이 확인함으로 바뀌었어요');
});
