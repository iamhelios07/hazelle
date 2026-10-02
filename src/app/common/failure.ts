import type { ApiFailure } from '../../runtime/api';
import type { CatalogFailure } from '../../runtime/catalog';
import type { MemoryFailure } from '../../runtime/memory';
import type { AddFailure } from '../../runtime/connections';
import type { ReplyError } from '../../runtime/generate';
import type { MetersFailure } from '../../runtime/meters';
import type { SignInFailure } from '../../runtime/sign-in';
import type { TranslateFailure, TranslatorFailure } from '../../runtime/translate';
import type { TurnFailure } from '../../runtime/turn';
import { inSettings, MODEL_ROLES } from './words';

const MESSAGES: Record<string, string> = {
  'bad-username': '아이디는 2–32자의 글자, 숫자, _ . - 로만 만들 수 있어요.',
  'signup-closed': '지금은 자리가 다 차서 계정을 만들 수 없어요. 자리가 늘면 다시 만들 수 있어요.',
  // Signup's last step, after the recovery key; the name is set on the step before.
  'username-taken': '이미 있는 아이디예요. 이전으로 돌아가 다른 아이디를 정해 주세요.',
  'account-mismatch': '다른 탭에서 다른 계정으로 로그인해서 이 탭에서 한 일은 받지 않았어요. 이 탭에서 다시 로그인해 주세요.',
  suspended: `운영자가 이 계정을 정지해서 저장하거나 모델을 부를 수 없어요. ${inSettings('account')}에서 백업을 받거나 운영자에게 알릴 수 있어요.`,
  'too-many-calls': '모델을 너무 자주 불렀어요. 잠시 뒤 다시 해 주세요.',
  'storage-full': '이 계정의 저장 공간이 가득 찼어요. 채팅을 지우거나 지운 캐릭터를 완전히 지우면 자리가 생겨요.',
  'file-blocked': '운영자가 막은 파일이라 올리거나 열 수 없어요. 다른 파일을 써 주세요.',
  'too-many-reports': '아직 확인하지 않은 알림이 많아서 더 보낼 수 없어요. 운영자가 확인하면 다시 보낼 수 있어요.',
  'not-admin': '운영자 계정에서만 할 수 있어요.',
  'no-session': '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.',
  conflict: '다른 기기에서 같은 것을 동시에 고치고 있어서 저장하지 못했어요. 다시 해 주세요.',
  unreadable: '금고 열쇠로 열리지 않는 항목이라 고칠 수 없어요.',
  gone: '다른 곳에서 지워진 항목이라 고칠 수 없어요.',
  'too-large': '너무 커서 저장할 수 없어요.',
  offline: '서버에 닿지 못했어요. 연결을 확인해 주세요.',
  'timeline-changed': '계정을 복원해서 하던 일을 멈췄어요. 다시 해 주세요.',
  'account-restoring': '계정을 복원하는 중이에요. 잠시 뒤 다시 해 주세요.',
  'account-busy': '운영자가 이 계정을 복원하는 중이라 지금은 할 수 없어요. 잠시 뒤 다시 해 주세요.',
  'stream-gone': '서버가 이 답을 더 이상 갖고 있지 않아요.',
  'stream-lost': '서버가 답을 받다가 놓쳤어요.',
};

const SERVER_TROUBLE = '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요.';

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
  return MESSAGES[failure.error] ?? SERVER_TROUBLE;
}

const REFUSED: Record<string, string> = {
  'max-tokens-unknown': '이 모델의 최대 출력 길이를 몰라서 보낼 수 없어요.',
  'unknown-connection-type': '이 버전이 모르는 연결 종류예요. 새로고침해 보세요.',
  'unsupported-protocol': '이 모델이 받는 요청 방식을 이 앱이 아직 몰라요.',
  'model-gone': '이 답을 받던 모델이 연결에서 빠져서 이어 받을 수 없어요.',
};

// The relay refuses these, and 직접 연결 says so before it tries.
export const HTTPS_ONLY = 'https 주소만 연결할 수 있어요.';

const RELAY: Record<string, string> = {
  'not-https': HTTPS_ONLY,
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
      return MESSAGES[error.code] ?? SERVER_TROUBLE;
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

export function describeAddFailure(failure: AddFailure): string {
  switch (failure.kind) {
    case 'models':
      return describeCatalogFailure(failure.failure);
    case 'key':
      return describeMetersFailure(failure.failure);
    case 'save':
      return describeFailure(failure.failure);
    case 'stopped':
      return describeReplyError(failure);
  }
}

export const RUNAWAY_FIX = '캐릭터, 로어북, 프롬프트, 메시지에서 서로를 끝없이 불러오는 명령어를 고쳐 주세요.';
const runaway = (before: string) => `명령어가 글을 너무 많이 만들어서 ${before} 멈췄어요. ${RUNAWAY_FIX}`;

export function describeTurnFailure(failure: TurnFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `${MODEL_ROLES.main}이 정해지지 않았어요. 모델 버튼에서 골라 주세요.`;
    case 'model-gone':
      return '고른 모델이 별표한 모델에 없어요. 모델 버튼에서 다시 골라 주세요.';
    case 'prompt-missing':
      return failure.own ? '이 채팅의 프롬프트가 지워졌어요. 다른 프롬프트를 골라 주세요.' : `기본 프롬프트가 없어요. ${inSettings('prompts')}에서 하나를 기본으로 정해 주세요.`;
    case 'persona-missing':
      return failure.own ? '이 채팅의 페르소나가 지워졌어요. 다른 페르소나를 골라 주세요.' : `기본 페르소나가 지워졌어요. ${inSettings('personas')}에서 다른 페르소나를 기본으로 정해 주세요.`;
    case 'profile-missing':
      return failure.own ? `이 모델이 쓰던 설정이 지워졌어요. ${inSettings('models')}에서 다른 설정을 골라 주세요.` : `기본 설정이 없어요. ${inSettings('models')}에서 다른 설정을 기본으로 정해 주세요.`;
    case 'runaway':
      return runaway('보내기 전에');
    case 'tokenizer':
      return '토큰 계산기를 불러오지 못했어요. 새로고침한 뒤 다시 보내 주세요.';
    case 'too-long':
      if (failure.budget <= 0) return `이 모델의 답장 최대 길이가 컨텍스트만큼 커서 프롬프트가 들어갈 자리가 없어요. ${inSettings('models')}에서 이 모델의 답장 최대 길이를 줄여 주세요.`;
      return `마지막 메시지만 남겨도 프롬프트가 약 ${failure.tokens.toLocaleString('ko-KR')} 토큰이라, 답장 최대 길이를 뺀 이 모델의 자리 ${failure.budget.toLocaleString('ko-KR')} 토큰에 들어가지 않아요. 프롬프트나 로어북을 줄이거나 ${inSettings('models')}에서 이 모델의 설정을 바꿔 주세요.`;
    case 'unstarted':
      return `채팅을 만들지 못했어요. ${describeFailure(failure.failure)}`;
    case 'unpulled':
      return `최신 대화를 확인하지 못해서 보내지 않았어요. ${describeFailure(failure.failure)}`;
    case 'gone':
      return '다른 기기에서 지워져서 보내지 않았어요.';
    case 'unsent':
      return `보낸 말을 저장하지 못해서 답장을 멈췄어요. ${describeFailure(failure.failure)}`;
    case 'unsaved':
      return `답장을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'untranslated':
      return failure.failure.kind === 'stopped' ? '번역하다 멈춰서 보내지 않았어요.' : `보낼 말을 번역하지 못해서 보내지 않았어요. ${describeTranslateFailure(failure.failure)}`;
  }
}

export function describeTranslateFailure(failure: Exclude<TranslateFailure, { kind: 'stopped' }> | TranslatorFailure): string {
  switch (failure.kind) {
    case 'prompt-missing':
      return failure.own ? '고른 번역 프롬프트가 지워졌어요. 채팅의 번역 메뉴에서 다른 프롬프트를 골라 주세요.' : `기본 번역 프롬프트가 없어요. ${inSettings('prompts')}에서 번역 프롬프트 하나를 기본으로 정해 주세요.`;
    case 'runaway':
      return runaway('번역하기 전에');
    case 'tokenizer':
      return '토큰 계산기를 불러오지 못했어요. 새로고침한 뒤 다시 번역해 주세요.';
    case 'no-model':
      return `번역 모델이 정해지지 않았어요. 번역 프롬프트나 ${inSettings('models')}에서 골라 주세요.`;
    case 'model-gone':
      return `번역에 쓸 모델이 별표한 모델에 없어요. 번역 프롬프트나 ${inSettings('models')}에서 다시 골라 주세요.`;
    case 'profile-missing':
      return failure.own ? `번역 모델이 쓰던 설정이 지워졌어요. ${inSettings('models')}에서 다른 설정을 골라 주세요.` : `기본 설정이 없어요. ${inSettings('models')}에서 다른 설정을 기본으로 정해 주세요.`;
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 빈 번역을 보냈어요.';
    case 'unsaved':
      return `번역을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
}

const INVALID = {
  unreadable: '모델의 답을 기록으로 읽지 못했어요.',
  fields: '모델의 답에 빠진 칸이 있어요.',
  lines: '기록에 옮긴 대사가 원문에 그대로 있지 않아요.',
} as const;

export function describeMemoryFailure(failure: MemoryFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `기억을 정리할 모델이 정해지지 않았어요. 기억 프롬프트나 ${inSettings('models')}에서 골라 주세요.`;
    case 'model-gone':
      return `기억 정리에 쓸 모델이 별표한 모델에 없어요. 기억 프롬프트나 ${inSettings('models')}에서 다시 골라 주세요.`;
    case 'prompt-missing':
      return `기본 기억 프롬프트가 없어요. ${inSettings('prompts')}에서 기억 프롬프트 하나를 기본으로 정해 주세요.`;
    case 'profile-missing':
      return failure.own ? `기억 모델이 쓰던 설정이 지워졌어요. ${inSettings('models')}에서 다른 설정을 골라 주세요.` : `기본 설정이 없어요. ${inSettings('models')}에서 다른 설정을 기본으로 정해 주세요.`;
    case 'runaway':
      return runaway('기억을 정리하기 전에');
    case 'tokenizer':
      return '토큰 계산기를 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요.';
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 빈 답을 보냈어요.';
    case 'invalid':
      return INVALID[failure.reason];
    case 'unsaved':
      return `기억을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
}
