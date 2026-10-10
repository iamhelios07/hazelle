import type { ApiFailure } from '../../runtime/api';
import type { CatalogFailure } from '../../runtime/catalog';
import type { IllustrateFailure } from '../../runtime/illustrate';
import type { MemoryFailure } from '../../runtime/memory';
import type { AddFailure } from '../../runtime/connections';
import type { ReplyError } from '../../runtime/generate';
import type { MetersFailure } from '../../runtime/meters';
import type { SignInFailure } from '../../runtime/sign-in';
import type { TranslateFailure, TranslatorFailure } from '../../runtime/translate';
import type { TurnFailure } from '../../runtime/turn';
import { count } from './typedNumber';
import { BIN, BOT_STUCK, inSettings, MODEL_ROLES, UNREADABLE_IMAGE } from './words';

const MESSAGES: Record<string, string> = {
  'bad-username': '아이디는 2~32자의 문자, 숫자, _ . - 로만 만들 수 있어요.',
  'signup-closed': '가입 인원이 다 차서 계정을 만들 수 없어요.',
  // Signup's last step, after the recovery key; the name is set on the step before.
  'username-taken': '이미 사용 중인 아이디예요. 이전 단계에서 다른 아이디를 입력해 주세요.',
  'account-mismatch': '다른 탭에서 다른 계정으로 로그인해서 이 탭의 변경 사항을 저장하지 못했어요. 이 탭에서 다시 로그인해 주세요.',
  suspended: `정지된 계정이라 저장하거나 모델을 호출할 수 없어요. 백업은 ${inSettings('account')}에서 받을 수 있어요.`,
  'too-many-calls': '모델 호출이 너무 잦아요. 잠시 후 다시 시도해 주세요.',
  'storage-full': `저장 공간이 가득 찼어요. ${BIN}에서 영구 삭제하면 공간이 생겨요.`,
  'tool-file-refused': '도구 파일을 저장하지 못했어요. 파일 한도나 차단 여부를 확인해 주세요.',
  'picture-unreadable': UNREADABLE_IMAGE,
  'picture-refused': '이미지가 너무 크거나, 차단됐거나, 파일 한도를 넘었어요.',
  'file-blocked': '운영자가 차단한 파일이라 올리거나 열 수 없어요.',
  'too-many-reports': '운영자가 확인하지 않은 알림이 많아서 더 보낼 수 없어요.',
  'not-admin': '운영자 계정에서만 할 수 있어요.',
  'no-session': '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.',
  conflict: '다른 기기에서 동시에 변경해서 저장하지 못했어요. 다시 시도해 주세요.',
  unreadable: '암호화 키로 열 수 없는 항목이라 변경할 수 없어요.',
  'evaluation-unavailable': '채팅을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
  'bot-stuck': `${BOT_STUCK}.`,
  'codec-unavailable': '데이터를 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
  gone: '다른 곳에서 삭제된 항목이라 변경할 수 없어요.',
  'too-large': '너무 커서 저장할 수 없어요.',
  offline: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.',
  'timeline-changed': '계정이 복원되어 작업을 중단했어요. 다시 시도해 주세요.',
  'account-restoring': '계정을 복원하는 중이에요. 잠시 후 다시 시도해 주세요.',
  'account-busy': '운영자가 계정을 복원하는 중이에요. 잠시 후 다시 시도해 주세요.',
  'stream-gone': '이 응답은 서버에 더 이상 없어요.',
  'stream-lost': '서버가 응답을 받다가 연결이 끊겼어요.',
};

const SERVER_TROUBLE = '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
const NO_DEFAULT_PROFILE = `기본 설정이 없어요. ${inSettings('models')}에서 설정 하나를 기본으로 지정해 주세요.`;

const SECRET = { password: '비밀번호가', recovery: '복구 키가' } as const;

// Signed out, the username may be the wrong part.
export function wrongSecret(method: keyof typeof SECRET, withUsername: boolean): string {
  return `${withUsername ? '아이디나 ' : ''}${SECRET[method]} 맞지 않아요.`;
}

export function describeFailure(failure: ApiFailure): string {
  if (failure.error === 'too-many-attempts' && failure.retryAfter !== undefined) {
    return `시도가 너무 많았어요. ${Math.ceil(failure.retryAfter / 60)}분 후에 다시 시도해 주세요.`;
  }
  // The code is what to tell the operator: without it a failure no screen expected cannot be told apart.
  return MESSAGES[failure.error] ?? `${SERVER_TROUBLE} (${failure.error}${failure.status === undefined ? '' : ` ${failure.status}`})`;
}

const REFUSED: Record<string, string> = {
  'max-tokens-unknown': '이 모델의 최대 출력 길이를 알 수 없어서 보낼 수 없어요.',
  'unknown-connection-type': '지원하지 않는 연결 종류예요. 새로고침해 주세요.',
  'unsupported-protocol': '이 모델의 요청 방식은 지원하지 않아요.',
  'image-only': '이미지만 만드는 모델이라 대화에 쓸 수 없어요.',
  'too-many-characters': '이 모델이 한 장면에 그릴 수 있는 인물 수를 넘었어요.',
  'unknown-model': '이 버전에서 모르는 모델이에요. 새로고침해 주세요.',
  'unknown-sampler': '이 모델이 모르는 샘플러예요. 삽화 프롬프트에서 샘플러를 다시 선택해 주세요.',
  'model-gone': '모델이 연결에서 빠져서 응답을 이어 받을 수 없어요.',
};

// The relay refuses these, and 직접 연결 says so before it tries.
export const HTTPS_ONLY = 'https 주소만 연결할 수 있어요.';

const RELAY: Record<string, string> = {
  'not-https': HTTPS_ONLY,
  'not-public': '공개된 주소만 연결할 수 있어요.',
  'upstream-unreachable': '제공자 서버에 연결하지 못했어요. 주소를 확인하거나 잠시 후 다시 시도해 주세요.',
  'upstream-redirect': '주소가 다른 곳으로 이동됐어요. 주소를 확인해 주세요.',
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
            ? '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
            : status >= 500
              ? '제공자 서버에 문제가 생겼어요.'
              : `제공자가 요청을 거절했어요 (${status}).`;
  return detail ? `${ours} ${detail}` : ours;
}

export function describeReplyError(error: ReplyError): string {
  switch (error.kind) {
    case 'refused':
      return REFUSED[error.code] ?? error.code;
    case 'provider':
      return 'status' in error ? provider(error.status, error.detail) : `제공자가 오류를 보냈어요. ${error.detail}`;
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
      return '로그인 토큰을 받지 못했어요. 연결을 삭제하고 다시 로그인해 주세요.';
    case 'pool':
      return `${error.group}에 계정이 없어요. 연결에서 계정을 옮기거나 추가해 주세요.`;
  }
}

const SIGN_IN_REFUSED: Record<string, string> = {
  expired_token: '코드가 만료됐어요. 다시 시도해 주세요.',
  access_denied: '로그인을 취소했어요.',
};

export function describeSignInFailure(failure: SignInFailure, site: string): string {
  if (failure.kind === 'bad-answer') return `${site}의 응답을 읽지 못했어요. 다시 시도해 주세요.`;
  if (failure.kind === 'refused') return SIGN_IN_REFUSED[failure.code] ?? `${site}가 로그인을 거절했어요 (${failure.code}).`;
  return describeReplyError(failure);
}

export function describeCatalogFailure(failure: CatalogFailure): string {
  if (failure.kind === 'not-a-catalog') return '모델 목록을 받지 못했어요. 주소를 확인해 주세요.';
  return describeReplyError(failure);
}

export function describeMetersFailure(failure: MetersFailure): string {
  if (failure.kind === 'not-meters') return '사용량을 읽지 못했어요.';
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

export const RUNAWAY_FIX = '캐릭터, 로어북, 프롬프트, 메시지에서 서로를 무한히 호출하는 명령어를 수정해 주세요.';
const runaway = (before: string) => `명령어 결과가 너무 길어서 ${before} 중단했어요. ${RUNAWAY_FIX}`;

export function describeTurnFailure(failure: TurnFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `${MODEL_ROLES.main}이 지정되지 않았어요. 모델 버튼에서 선택해 주세요.`;
    case 'model-gone':
      return '선택한 모델이 즐겨찾기에 없어요. 모델 버튼에서 다시 선택해 주세요.';
    case 'image-only':
      return '선택한 모델은 이미지만 만들어요. 모델 버튼에서 다른 모델을 선택해 주세요.';
    case 'prompt-missing':
      return failure.own ? '이 채팅의 프롬프트가 삭제됐어요. 다른 프롬프트를 선택해 주세요.' : `기본 프롬프트가 없어요. ${inSettings('prompts')}에서 하나를 기본으로 지정해 주세요.`;
    case 'persona-missing':
      return {
        chat: '이 채팅의 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
        character: '이 캐릭터에 고정한 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
        current: '현재 페르소나가 삭제됐어요. 다른 페르소나를 선택해 주세요.',
      }[failure.from];
    case 'profile-missing':
      return failure.own ? `이 모델의 설정이 삭제됐어요. ${inSettings('models')}에서 다른 설정을 선택해 주세요.` : NO_DEFAULT_PROFILE;
    case 'runaway':
      return runaway('보내기 전에');
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 보내 주세요.';
    case 'too-long':
      if (failure.budget <= 0) return `응답 최대 길이가 컨텍스트 길이만큼 커서 프롬프트를 넣을 수 없어요. ${inSettings('models')}에서 이 모델의 응답 최대 길이를 줄여 주세요.`;
      return `마지막 메시지만 넣어도 프롬프트가 약 ${count(failure.tokens)} 토큰이라 이 모델에 넣을 수 있는 ${count(failure.budget)} 토큰을 넘어요. 프롬프트나 로어북을 줄이거나 ${inSettings('models')}에서 이 모델의 설정을 바꿔 주세요.`;
    case 'unstarted':
      return `채팅을 만들지 못했어요. ${describeFailure(failure.failure)}`;
    case 'unpulled':
      return `최신 대화를 불러오지 못해서 보내지 않았어요. ${describeFailure(failure.failure)}`;
    case 'gone':
      return '다른 기기에서 삭제돼서 보내지 않았어요.';
    case 'unsent':
      return `보낸 메시지를 저장하지 못해서 응답을 중단했어요. ${describeFailure(failure.failure)}`;
    case 'unsaved':
      return `응답을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'untranslated':
      return failure.failure.kind === 'stopped' ? '번역을 멈춰서 보내지 않았어요.' : `메시지를 번역하지 못해서 보내지 않았어요. ${describeTranslateFailure(failure.failure)}`;
  }
}

export function describeTranslateFailure(failure: Exclude<TranslateFailure, { kind: 'stopped' }> | TranslatorFailure): string {
  switch (failure.kind) {
    case 'prompt-missing':
      return failure.own ? '선택한 번역 프롬프트가 삭제됐어요. 채팅의 번역 메뉴에서 다른 프롬프트를 선택해 주세요.' : `기본 번역 프롬프트가 없어요. ${inSettings('prompts')}에서 번역 프롬프트 하나를 기본으로 지정해 주세요.`;
    case 'runaway':
      return runaway('번역하기 전에');
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 번역해 주세요.';
    case 'no-model':
      return `번역 모델이 지정되지 않았어요. 번역 프롬프트나 ${inSettings('models')}에서 선택해 주세요.`;
    case 'model-gone':
      return `번역 모델이 즐겨찾기에 없어요. 번역 프롬프트나 ${inSettings('models')}에서 다시 선택해 주세요.`;
    case 'image-only':
      return `번역 모델은 이미지만 만들어요. 번역 프롬프트나 ${inSettings('models')}에서 다른 모델을 선택해 주세요.`;
    case 'profile-missing':
      return failure.own ? `번역 모델의 설정이 삭제됐어요. ${inSettings('models')}에서 다른 설정을 선택해 주세요.` : NO_DEFAULT_PROFILE;
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 빈 번역을 보냈어요.';
    case 'unsaved':
      return `번역을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
}

const INVALID = {
  unreadable: '모델 응답의 형식이 맞지 않아요.',
  fields: '모델 응답에 빠진 항목이 있어요.',
} as const;

export function describeMemoryFailure(failure: MemoryFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `기억 정리 모델이 지정되지 않았어요. 기억 프롬프트나 ${inSettings('models')}에서 선택해 주세요.`;
    case 'model-gone':
      return `기억 정리 모델이 즐겨찾기에 없어요. 기억 프롬프트나 ${inSettings('models')}에서 다시 선택해 주세요.`;
    case 'image-only':
      return `기억 정리 모델은 이미지만 만들어요. 기억 프롬프트나 ${inSettings('models')}에서 다른 모델을 선택해 주세요.`;
    case 'prompt-missing':
      return `기본 기억 프롬프트가 없어요. ${inSettings('prompts')}에서 기억 프롬프트 하나를 기본으로 지정해 주세요.`;
    case 'profile-missing':
      return failure.own ? `기억 정리 모델의 설정이 삭제됐어요. ${inSettings('models')}에서 다른 설정을 선택해 주세요.` : NO_DEFAULT_PROFILE;
    case 'runaway':
      return runaway('기억을 정리하기 전에');
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.';
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 빈 응답을 보냈어요.';
    case 'invalid':
      return INVALID[failure.reason];
    case 'unsaved':
      return `기억을 저장하지 못했어요. ${describeFailure(failure.failure)}`;
    case 'embed':
      return EMBED[failure.reason] ?? (failure.receipt?.error ? describeReplyError(failure.receipt.error) : `${MODEL_ROLES.embed}을 호출하지 못했어요.`);
  }
}

const EMBED: Partial<Record<Extract<MemoryFailure, { kind: 'embed' }>['reason'], string>> = {
  'too-large': `기록이 ${MODEL_ROLES.embed}의 한도보다 길어요.`,
  flood: '이 채팅의 모델 호출이 너무 잦아요. 잠시 뒤 다시 시도해 주세요.',
};

const SCENE_INVALID = { ...INVALID, paragraph: '모델이 메시지에 없는 문단을 골랐어요.' } as const;

export function describeIllustrateFailure(failure: IllustrateFailure): string {
  switch (failure.kind) {
    case 'no-model':
      return `장면 모델이 지정되지 않았어요. 삽화 프롬프트나 ${inSettings('models')}에서 선택해 주세요.`;
    case 'model-gone':
      return `장면 모델이 즐겨찾기에 없어요. 삽화 프롬프트나 ${inSettings('models')}에서 다시 선택해 주세요.`;
    case 'image-only':
      return `장면 모델은 이미지만 만들어요. 삽화 프롬프트나 ${inSettings('models')}에서 다른 모델을 선택해 주세요.`;
    case 'prompt-missing':
      return failure.own ? '선택한 삽화 프롬프트가 삭제됐어요. 채팅의 삽화 메뉴에서 다른 프롬프트를 선택해 주세요.' : `기본 삽화 프롬프트가 없어요. ${inSettings('prompts')}에서 삽화 프롬프트 하나를 기본으로 지정해 주세요.`;
    case 'profile-missing':
      return failure.own ? `장면 모델의 설정이 삭제됐어요. ${inSettings('models')}에서 다른 설정을 선택해 주세요.` : NO_DEFAULT_PROFILE;
    case 'tokenizer':
      return '토큰 수를 계산하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.';
    case 'runaway':
      return runaway('장면을 정하기 전에');
    case 'failed':
      return failure.receipt.error ? describeReplyError(failure.receipt.error) : '모델이 빈 응답을 보냈어요.';
    case 'invalid':
      return SCENE_INVALID[failure.reason];
    case 'no-image-model':
      return `이미지 모델이 없어요. ${inSettings('connections')}에서 NovelAI를 연결해 주세요.`;
    case 'image-model-gone':
      return '선택한 이미지 모델이 즐겨찾기에 없어요. 채팅의 삽화 메뉴에서 다시 선택해 주세요.';
    case 'undrawn':
      return describeReplyError(failure.error);
    case 'not-a-picture':
      return '이미지가 아닌 응답이 왔어요.';
    case 'costs':
      return '무료로 만들 수 없는 이미지예요. 무료 사용량을 다 썼거나 요금제에 무료 이미지가 없어요.';
    case 'file-refused':
      return '서버가 이미지 저장을 거절했어요.';
    case 'gone':
      return '메시지가 삭제됐어요.';
    case 'empty':
      return '내용이 없는 메시지예요.';
    case 'unsaved':
      return `삽화를 저장하지 못했어요. ${describeFailure(failure.failure)}`;
  }
}
