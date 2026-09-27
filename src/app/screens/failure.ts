import type { ApiFailure } from '../api';

const MESSAGES: Record<string, string> = {
  'wrong-login': '아이디나 비밀번호가 맞지 않아요.',
  'bad-username': '아이디는 2–32자의 글자, 숫자, _ . - 로만 만들 수 있어요.',
  'short-password': '비밀번호는 8자 이상이어야 해요.',
  'signup-closed': '이미 계정이 있어요. 새로고침한 뒤 로그인해 주세요.',
  offline: '서버에 닿지 못했어요. 연결을 확인해 주세요.',
};

export function describeFailure(failure: ApiFailure): string {
  if (failure.error === 'too-many-attempts' && failure.retryAfter !== undefined) {
    return `시도가 너무 많았어요. ${Math.ceil(failure.retryAfter / 60)}분 뒤에 다시 해 주세요.`;
  }
  return MESSAGES[failure.error] ?? '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';
}
