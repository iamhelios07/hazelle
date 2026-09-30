import type { Role } from '../../connectors/assignment';

// The words several screens use for one thing, so it reads the same wherever it appears. Sentences stay in their
// screen and are built from these; the phrases these replaced are refused by lint (RETIRED_COPY in eslint.config.js).
// Kept apart on purpose, not variants of one word: 빼기 takes out of a list, 지우기 deletes. 편집 opens an item's
// editor, 수정 changes a message in place. 새 답장 받기 asks for another reply, 다시 시도 repeats a failed or stopped
// one. 컨텍스트 길이 is the model's own, 컨텍스트 한도 the setting. 원문 is what a translation came from, 요청 원문
// the request a reply was asked with. 사용 중 marks what is in use, 쓰는 중 a reply being written.

export const MODEL_ROLES: Record<Role, string> = { main: '대화 모델', aux: '보조 모델' };

export const AUX_HELP = '번역처럼 대화 밖에서 하는 일에 써요. 번역 프롬프트에서 모델을 고르면 번역은 그 모델로 해요.';

export const SETTINGS = '설정';

// 설정's pages, which SettingsNav lists and a sentence points to.
export const PAGES = { prompts: '프롬프트', personas: '페르소나', connections: '연결', profiles: '모델 설정', defaults: '기본값', account: '계정' };

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;

// An unset choice takes its value from somewhere else, and names it: 기본값 따르기, 보조 모델 따르기.
export const follows = (source: string) => `${source} 따르기`;

export const NOT_STARRED = '별표한 모델에 없음';

export const noStarred = (then: string) => `별표한 모델이 없어요. ${inSettings('connections')}에서 모델에 별표하면 여기서 ${then}.`;
