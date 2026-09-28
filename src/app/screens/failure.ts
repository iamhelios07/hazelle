import type { ApiFailure } from '../../runtime/api';
import type { CatalogFailure } from '../../runtime/catalog';
import type { ReplyError } from '../../runtime/generate';
import type { MetersFailure } from '../../runtime/meters';
import type { SignInFailure } from '../../runtime/sign-in';
import type { TalkFailure } from '../../runtime/talk';

const MESSAGES: Record<string, string> = {
  'bad-username': '아이디는 2–32자의 글자, 숫자, _ . - 로만 만들 수 있어요.',
  'signup-closed': '이미 계정이 있어요. 새로고침한 뒤 로그인해 주세요.',
  'no-session': '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.',
  conflict: '다른 기기에서 같은 것을 동시에 고치고 있어서 저장하지 못했어요. 다시 해 주세요.',
  unreadable: '금고 열쇠로 열리지 않는 항목이라 고칠 수 없어요.',
  'too-large': '너무 커서 저장할 수 없어요.',
  offline: '서버에 닿지 못했어요. 연결을 확인해 주세요.',
};

const SECRET = { password: '비밀번호가', recovery: '복구 키가' } as const;

// A refused password or recovery key, named the way the user chose to sign in. Signed out, the
// username may be the wrong part.
export function wrongSecret(method: keyof typeof SECRET, withUsername: boolean): string {
  return `${withUsername ? '아이디나 ' : ''}${SECRET[method]} 맞지 않아요.`;
}

export function describeFailure(failure: ApiFailure): string {
  if (failure.error === 'too-many-attempts' && failure.retryAfter !== undefined) {
    return `시도가 너무 많았어요. ${Math.ceil(failure.retryAfter / 60)}분 뒤에 다시 해 주세요.`;
  }
  return MESSAGES[failure.error] ?? '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';
}

const REFUSED: Record<string, string> = {
  'max-tokens-unknown': '이 모델의 최대 출력 길이를 몰라서 보낼 수 없어요.',
  'unknown-connection-type': '이 버전이 모르는 연결 종류예요. 새로고침해 보세요.',
  'unsupported-protocol': '이 모델이 받는 요청 방식을 이 앱이 아직 몰라요.',
};

const RELAY: Record<string, string> = {
  'not-https': 'https 주소만 연결할 수 있어요.',
  'not-public': '서버에서 닿을 수 없는 주소예요. 내 컴퓨터나 집 안 네트워크의 주소는 연결할 수 없어요.',
  'upstream-unreachable': '프로바이더 서버에 닿지 못했어요. 주소를 확인하거나 잠시 뒤 다시 해 주세요.',
  'upstream-redirect': '주소가 다른 곳으로 옮겨졌다고 해요. 주소를 확인해 주세요.',
};

// The provider's own words follow ours, so an unfamiliar refusal still says what happened.
function provider(status: number, detail: string): string {
  const ours =
    status === 401 || status === 403
      ? '키가 맞지 않거나 권한이 없어요.'
      : status === 402
        ? '잔액이나 한도가 부족해요.'
        : status === 404
          ? '주소나 모델을 찾지 못했어요.'
          : status === 429
            ? '요청이 너무 많다고 해요. 잠시 뒤 다시 해 주세요.'
            : status >= 500
              ? '프로바이더 서버에 문제가 생겼어요.'
              : `프로바이더가 거절했어요 (${status}).`;
  return detail ? `${ours} ${detail}` : ours;
}

export function describeReplyError(error: ReplyError): string {
  switch (error.kind) {
    case 'refused':
      return REFUSED[error.code] ?? error.code;
    case 'provider':
      return 'status' in error ? provider(error.status, error.detail) : `프로바이더가 오류를 보냈어요. ${error.detail}`;
    case 'relay':
      return RELAY[error.code] ?? '중계 서버가 요청을 거절했어요.';
    case 'app':
      return MESSAGES[error.code] ?? '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';
    case 'offline':
      return MESSAGES.offline!;
    case 'stopped':
      return '멈췄어요.';
    case 'bad-event':
      return `응답을 읽지 못했어요. ${error.detail}`;
    case 'network':
      return '응답을 받다가 연결이 끊겼어요.';
    case 'no-token':
      return '로그인한 계정으로 쓸 토큰을 받지 못했어요. 연결을 지우고 다시 로그인해 주세요.';
  }
}

const SIGN_IN_REFUSED: Record<string, string> = {
  expired_token: '코드를 쓸 수 있는 시간이 지났어요. 다시 해 주세요.',
  access_denied: '로그인을 취소했어요.',
};

export function describeSignInFailure(failure: SignInFailure, site: string): string {
  if (failure.kind === 'bad-answer') return `${site}의 답을 읽지 못했어요. 다시 해 주세요.`;
  if (failure.kind === 'refused') return SIGN_IN_REFUSED[failure.code] ?? `${site}가 로그인을 거절했어요 (${failure.code}).`;
  return describeReplyError(failure);
}

export function describeCatalogFailure(failure: CatalogFailure): string {
  if (failure.kind === 'not-a-catalog') return '모델 목록이 오지 않았어요. 주소를 확인해 주세요.';
  return describeReplyError(failure);
}

export function describeMetersFailure(failure: MetersFailure): string {
  if (failure.kind === 'not-meters') return '사용량을 읽지 못했어요. 프로바이더가 알 수 없는 모양으로 답했어요.';
  return describeReplyError(failure);
}

export function describeTalkFailure(failure: TalkFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return '본 대화 모델이 정해지지 않았어요. 모델 버튼에서 골라 주세요.';
    case 'model-gone':
      return '고른 모델이 별표 목록에 없어요. 모델 버튼에서 다시 골라 주세요.';
    case 'unsent':
      return `보낸 말을 저장하지 못해서 답장을 멈췄어요. ${describeFailure(failure.failure)}`;
    case 'unsaved':
      return `답장을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
}
