import { ANSWER_INSTRUCTION_LABEL, DEFAULT_MODELS, FEATURE_NAMES, FEATURES_TITLE, LORE_BUDGET_LABEL, MODEL_ROLES, MODEL_SETTINGS, NETWORK, RETRY_COUNT, SCRIPTS, TRANSLATOR_NOTE } from '../../common/words';
import { LABS } from '../../common/labs';
import { FEATURES, type Feature } from '../../../model/features';
import type { Route, SettingsPage } from '../routes';

// 설정 검색's index: the section titles and setting labels each page shows, beside its own label. A page that renames or
// adds one changes it here too, or the search stops finding it.
export const TERMS: Record<SettingsPage, string[]> = {
  models: [DEFAULT_MODELS, MODEL_ROLES.main, MODEL_ROLES.aux, MODEL_ROLES.embed, '추가한 모델', MODEL_SETTINGS, '프롬프트에서 정한 모델'],
  connections: ['새 연결', '모델', '계정 추가', '사용량과 한도', RETRY_COUNT, '사용 내역'],
  chat: [FEATURES_TITLE, RETRY_COUNT, LORE_BUDGET_LABEL, ANSWER_INSTRUCTION_LABEL],
  translator: [TRANSLATOR_NOTE],
  labs: LABS.map(({ name }) => name),
  prompts: ['기본 프롬프트', 'Risu 프리셋 가져오기', '새 프롬프트'],
  personas: ['새 페르소나', '삽화 프로필'],
  modules: ['모듈 가져오기', '로어북', SCRIPTS.regex, SCRIPTS.triggers, '토글'],
  plugins: ['플러그인 가져오기', NETWORK],
  display: ['색', '테마', '이미지 가리기', '글꼴', '글자 크기', '줄 간격', '읽기 폭', '자동 스크롤', '헤더 숨기기', '입력창 접기', '프리셋'],
  account: ['저장 공간', '사용량', '잠그기', '로그아웃', '백업', '이전 시점으로 복원', '공유한 링크', '운영자가 보낸 알림', '운영자에게 알리기', '새 소식', '앱 정보', '버전', '탈퇴'],
  admin: ['가입 정원', '계정당 텍스트 한도', '계정당 이미지 한도', '기록', '신고'],
};

const FEATURE_TERMS: Record<Feature, string[]> = {
  translate: ['응답 번역', '내 메시지 번역', '반전 모드', TRANSLATOR_NOTE, '번역 프롬프트', '번역 모델'],
  illustrate: ['자동 삽화', '무료가 아니어도 만들기', '이미지 모델', '삽화 프롬프트'],
  memory: ['기록 최대 분량', '임베딩 모델로 찾는 기록', '원문으로 보낼 최근 대화', '한 번에 정리할 분량'],
  mascot: ['마스코트 프롬프트'],
};

// A page's own pages, a feature's under 설정 › 채팅: a hit on one of their labels or terms opens that page.
export const SUBPAGES: Partial<Record<SettingsPage, { label: string; route: Route; terms: string[] }[]>> = {
  chat: FEATURES.map((feature) => ({ label: FEATURE_NAMES[feature], route: { kind: 'feature', feature }, terms: FEATURE_TERMS[feature] })),
};
