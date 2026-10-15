import { DEFAULT_MODELS, LORE_BUDGET_LABEL, MODEL_ROLES, MODEL_SETTINGS, RETRY_COUNT, SCRIPTS, TRANSLATOR_NOTE } from '../../common/words';
import { LABS } from '../../common/labs';
import type { SettingsPage } from '../routes';

// 설정 검색's index: the section titles and setting labels each page shows, beside its own label. A page that renames or
// adds one changes it here too, or the search stops finding it.
export const TERMS: Record<SettingsPage, string[]> = {
  models: [DEFAULT_MODELS, MODEL_ROLES.main, MODEL_ROLES.aux, MODEL_ROLES.embed, '즐겨찾기한 모델', MODEL_SETTINGS, '프롬프트에서 정한 모델'],
  connections: ['새 연결', '모델', '계정 추가', '사용량과 한도', RETRY_COUNT, '사용 내역'],
  chat: ['장기 기억', '기록 최대 분량', '임베딩 모델로 찾는 기록', '원문으로 보낼 최근 대화', '한 번에 정리할 분량', '번역', TRANSLATOR_NOTE, RETRY_COUNT, LORE_BUDGET_LABEL],
  translator: [TRANSLATOR_NOTE],
  labs: LABS.map(({ name }) => name),
  prompts: ['기본 프롬프트', 'Risu 프리셋 가져오기', '새 프롬프트'],
  personas: ['새 페르소나', '삽화 프로필'],
  modules: ['모듈 가져오기', '로어북', SCRIPTS.regex, SCRIPTS.triggers, '토글'],
  display: ['색', '테마', '이미지 가리기', '글꼴', '글자 크기', '줄 간격', '읽기 폭', '자동 스크롤', '헤더 숨기기', '입력창 접기', '프리셋'],
  account: ['저장 공간', '사용량', '잠그기', '로그아웃', '백업', '이전 시점으로 복원', '공유한 링크', '운영자가 보낸 알림', '운영자에게 알리기', '새 소식', '앱 정보', '버전', '탈퇴'],
  admin: ['가입 정원', '계정당 텍스트 한도', '계정당 이미지 한도', '기록', '신고'],
};
